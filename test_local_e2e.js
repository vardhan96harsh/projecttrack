// backend/test_local_e2e.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";

// Load routes
import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import categoryRoutes from "./routes/categories.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import reportRoutes from "./routes/reports.js";
import machinesRouter from "./routes/machines.js";
import workSessionsRouter from "./routes/workSessions.js";
import manualRemarkRoutes from "./routes/manualRemarks.js";
import holidayRoutes from "./routes/holidays.js";
import taskRoutes from "./routes/tasks.js";
import projectPlanRoutes from "./routes/projectPlans.js";

// Models for cleanup
import WorkSession from "./models/WorkSession.js";
import ManualRemark from "./models/ManualRemark.js";
import User from "./models/User.js";

dotenv.config();

const PORT = 3099;
const TEST_BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

async function runLocalE2ETest() {
  console.log("\n=======================================================");
  console.log("  WORKTRACKER LOCAL BACKEND END-TO-END TEST SUITE");
  console.log("=======================================================\n");

  // 1. Connect MongoDB
  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";
  await mongoose.connect(MONGO);
  console.log("✓ Connected to MongoDB Atlas successfully.\n");

  // 2. Setup local Express App on port 3099
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/", (_req, res) => res.json({ ok: true, name: "ProjectTrack API (Local Test)" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/machines", machinesRouter);
  app.use("/api/work-sessions", workSessionsRouter);
  app.use("/api/manual-remarks", manualRemarkRoutes);
  app.use("/api/holidays", holidayRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/project-plans", projectPlanRoutes);

  const server = app.listen(PORT);
  console.log(`✓ Local test server running on ${TEST_BASE}\n`);

  // Find an admin and employee user for tokens
  const adminUser = await User.findOne({ role: "admin" }).lean();
  const employeeUser = await User.findOne({ role: "employee" }).lean();

  if (!adminUser || !employeeUser) {
    throw new Error("Missing admin or employee user in database to perform tests.");
  }

  const adminToken = jwt.sign(
    { id: adminUser._id, role: adminUser.role, name: adminUser.name },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const employeeToken = jwt.sign(
    { id: employeeUser._id, role: employeeUser.role, name: employeeUser.name },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  let passed = 0;
  let failed = 0;

  async function test(title, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${title}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  // Helpers
  async function apiGet(path, token) {
    const res = await fetch(`${TEST_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  async function apiPost(path, body, token) {
    const res = await fetch(`${TEST_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  async function apiPut(path, body, token) {
    const res = await fetch(`${TEST_BASE}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  async function apiDelete(path, token) {
    const res = await fetch(`${TEST_BASE}${path}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  // -------------------------------------------------------------
  // Test Suites
  // -------------------------------------------------------------

  console.log("--- 1. Health & Authentication ---");
  await test("GET / responds with status 200", async () => {
    const res = await apiGet("/");
    if (res.status !== 200 || !res.data?.ok) throw new Error(`Expected status 200, got ${res.status}`);
  });

  await test("POST /api/auth/login rejects invalid credentials", async () => {
    const res = await apiPost("/api/auth/login", { email: "nonexistent@test.com", password: "wrong" });
    if (res.status !== 401) throw new Error(`Expected status 401, got ${res.status}`);
  });

  console.log("\n--- 2. Master Data (Companies, Categories, Projects) ---");
  await test("GET /api/companies returns list of companies", async () => {
    const res = await apiGet("/api/companies", adminToken);
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) {
      throw new Error(`Expected array of companies, got ${res.status}`);
    }
  });

  await test("GET /api/categories returns list of categories", async () => {
    const res = await apiGet("/api/categories", adminToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected array of categories, got ${res.status}`);
    }
  });

  await test("GET /api/projects returns list of projects", async () => {
    const res = await apiGet("/api/projects", adminToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected array of projects, got ${res.status}`);
    }
  });

  console.log("\n--- 3. Users & Birthdays ---");
  await test("GET /api/users succeeds for admin", async () => {
    const res = await apiGet("/api/users", adminToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200, got ${res.status}`);
    }
  });

  await test("GET /api/users returns 403 Forbidden for employee", async () => {
    const res = await apiGet("/api/users", employeeToken);
    if (res.status !== 403) throw new Error(`Expected status 403, got ${res.status}`);
  });

  await test("GET /api/users/birthdays/today returns array", async () => {
    const res = await apiGet("/api/users/birthdays/today", employeeToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  console.log("\n--- 4. Employee Tasks (Assigned Deliverables) ---");
  await test("GET /api/tasks/my returns employee assigned tasks", async () => {
    const res = await apiGet("/api/tasks/my", employeeToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  await test("GET /api/tasks/my/count returns task count object", async () => {
    const res = await apiGet("/api/tasks/my/count", employeeToken);
    if (res.status !== 200 || typeof res.data?.count !== "number") {
      throw new Error(`Expected status 200 with count number, got ${JSON.stringify(res.data)}`);
    }
  });

  await test("GET /api/project-plans returns project plans array", async () => {
    const res = await apiGet("/api/project-plans", adminToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  console.log("\n--- 5. Manual Time Requests & Editing Lifecycle ---");
  let testRemarkId = null;

  await test("GET /api/manual-remarks/admin/pending-count returns pending count", async () => {
    const res = await apiGet("/api/manual-remarks/admin/pending-count", adminToken);
    if (res.status !== 200 || typeof res.data?.count !== "number") {
      throw new Error(`Expected status 200 with count number, got ${JSON.stringify(res.data)}`);
    }
  });

  await test("POST /api/manual-remarks creates a request with custom date & minutes", async () => {
    const customDate = "2026-09-08";
    const res = await apiPost(
      "/api/manual-remarks",
      {
        text: "Automated local test manual remark",
        requestedMinutes: 75,
        taskType: "Alpha",
        customTask: "Test Custom Deliverable",
        date: customDate,
      },
      employeeToken
    );

    if (res.status !== 200 || !res.data?._id) {
      throw new Error(`Failed to create manual remark: ${JSON.stringify(res.data)}`);
    }
    if (res.data.date !== customDate) {
      throw new Error(`Date mismatch: expected ${customDate}, got ${res.data.date}`);
    }
    if (res.data.requestedMinutes !== 75) {
      throw new Error(`Minutes mismatch: expected 75, got ${res.data.requestedMinutes}`);
    }
    testRemarkId = res.data._id;
  });

  await test("PUT /api/manual-remarks/:id updates requested minutes & date while pending", async () => {
    if (!testRemarkId) throw new Error("No test remark to update");
    const res = await apiPut(
      `/api/manual-remarks/${testRemarkId}`,
      {
        text: "Updated test remark text",
        requestedMinutes: 90,
        taskType: "CR",
        date: "2026-09-07",
      },
      employeeToken
    );

    if (res.status !== 200 || res.data?.requestedMinutes !== 90 || res.data?.date !== "2026-09-07") {
      throw new Error(`Update failed or returned unexpected payload: ${JSON.stringify(res.data)}`);
    }
  });

  await test("DELETE /api/manual-remarks/:id deletes pending request", async () => {
    if (!testRemarkId) throw new Error("No test remark to delete");
    const res = await apiDelete(`/api/manual-remarks/${testRemarkId}`, employeeToken);
    if (res.status !== 200) throw new Error(`Delete failed: ${JSON.stringify(res.data)}`);
    testRemarkId = null;
  });

  console.log("\n--- 6. Work Sessions (Timer & Admin Reports) ---");
  await test("GET /api/work-sessions/admin/list returns daily report session data", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await apiGet(`/api/work-sessions/admin/list?from=${today}&to=${today}`, adminToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  await test("GET /api/work-sessions/my returns employee sessions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await apiGet(`/api/work-sessions/my?from=${today}&to=${today}`, employeeToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  console.log("\n--- 7. Holiday Calendar & Reports Summary ---");
  await test("GET /api/holidays returns holiday schedule", async () => {
    const res = await apiGet("/api/holidays?year=2026&month=9", employeeToken);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      throw new Error(`Expected status 200 array, got ${res.status}`);
    }
  });

  await test("GET /api/reports/summary returns admin summary", async () => {
    const res = await apiGet("/api/reports/summary", adminToken);
    if (res.status !== 200) {
      throw new Error(`Expected status 200, got ${res.status}`);
    }
  });

  // Cleanup in case test failed midway
  if (testRemarkId) {
    await ManualRemark.findByIdAndDelete(testRemarkId);
  }

  // Close server and DB
  server.close();
  await mongoose.disconnect();

  console.log("\n=======================================================");
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runLocalE2ETest().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});
