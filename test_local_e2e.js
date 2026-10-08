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

  console.log("\n--- 8. Verification of Bug Fixes (TaskType Isolation, Reject Guard, Sync Merge) ---");
  await test("POST /api/manual-remarks/:id/reject only allows pending requests", async () => {
    const createRes = await apiPost(
      "/api/manual-remarks",
      {
        text: "Guard test remark",
        requestedMinutes: 45,
        customTask: "Guard Test Task",
      },
      employeeToken
    );
    const remarkId = createRes.data?._id;
    if (!remarkId) throw new Error("Could not create guard test remark");

    // 1st reject should succeed
    const rejRes1 = await apiPost(`/api/manual-remarks/${remarkId}/reject`, {}, adminToken);
    if (rejRes1.status !== 200) throw new Error(`1st reject expected 200, got ${rejRes1.status}`);

    // 2nd reject should fail with 400
    const rejRes2 = await apiPost(`/api/manual-remarks/${remarkId}/reject`, {}, adminToken);
    if (rejRes2.status !== 400) throw new Error(`2nd reject expected 400, got ${rejRes2.status}`);

    await ManualRemark.findByIdAndDelete(remarkId);
  });

  await test("POST /api/work-sessions/start does not overwrite paused session with different taskType", async () => {
    const project = await mongoose.model("Project").findOne().lean();
    const projectId = project?._id?.toString();

    // Start 1st session: Analysis
    const s1 = await apiPost(
      "/api/work-sessions/start",
      { customTask: "TaskType Test Custom", taskType: "Analysis" },
      employeeToken
    );
    if (s1.status !== 200 || !s1.data?._id) throw new Error("Could not start Analysis session");

    // Pause 1st session
    await apiPost("/api/work-sessions/pause", {}, employeeToken);

    // Start 2nd session: Alpha on same customTask
    const s2 = await apiPost(
      "/api/work-sessions/start",
      { customTask: "TaskType Test Custom", taskType: "Alpha" },
      employeeToken
    );
    if (s2.status !== 200 || !s2.data?._id) throw new Error("Could not start Alpha session");

    // Verify s1 is still in DB with taskType 'Analysis'
    const s1Check = await WorkSession.findById(s1.data._id).lean();
    if (s1Check.taskType !== "Analysis") {
      throw new Error(`TaskType corrupted! Expected 'Analysis', got '${s1Check.taskType}'`);
    }

    // Clean up
    await apiPost("/api/work-sessions/stop", {}, employeeToken);
    await WorkSession.deleteMany({ _id: { $in: [s1.data._id, s2.data._id] } });
  });

  await test("POST /api/work-sessions/sync-offline merges offline segments without wiping prior time", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Create base session with 60 minutes
    const baseSess = await WorkSession.create({
      user: employeeUser._id,
      customTask: "Offline Merge Test Task",
      date: today,
      status: "paused",
      accumulatedMinutes: 60,
      taskType: "CR",
      segments: [{
        start: new Date(Date.now() - 3600000),
        end: new Date(),
        manual: false,
        source: "online",
      }],
    });

    // Offline session for same task with 30 mins
    const segStart = new Date(Date.now() - 1800000);
    const segEnd = new Date();
    const syncRes = await apiPost(
      "/api/work-sessions/sync-offline",
      {
        offlineSession: {
          _id: "offline_test_123",
          date: today,
          customTask: "Offline Merge Test Task",
          taskType: "CR",
          status: "paused",
          accumulatedMinutes: 30,
          segments: [{
            start: segStart.toISOString(),
            end: segEnd.toISOString(),
            manual: false,
          }],
        },
      },
      employeeToken
    );

    if (syncRes.status !== 200 || !syncRes.data?.session) {
      throw new Error(`Sync failed: ${JSON.stringify(syncRes.data)}`);
    }

    const updated = await WorkSession.findById(baseSess._id).lean();
    if (updated.accumulatedMinutes < 89) { // ~60 + 30 = 90
      throw new Error(`Accumulated minutes lost! Expected ~90, got ${updated.accumulatedMinutes}`);
    }
    if (updated.segments.length < 2) {
      throw new Error(`Segments lost! Expected >= 2, got ${updated.segments.length}`);
    }

    // Call sync-offline 4 more times with the exact same payload to verify idempotency
    for (let i = 0; i < 4; i++) {
      const repeatRes = await apiPost(
        "/api/work-sessions/sync-offline",
        {
          offlineSession: {
            _id: "offline_test_123",
            date: today,
            customTask: "Offline Merge Test Task",
            taskType: "CR",
            status: "paused",
            accumulatedMinutes: 30,
            segments: [{
              start: segStart.toISOString(),
              end: segEnd.toISOString(),
              manual: false,
            }],
          },
        },
        employeeToken
      );
      if (repeatRes.status !== 200) {
        throw new Error(`Repeat sync failed at iteration ${i}`);
      }
    }

    const idempotentCheck = await WorkSession.findById(baseSess._id).lean();
    if (idempotentCheck.segments.length !== 2) {
      throw new Error(`Segments duplicated on repeated sync! Expected 2, got ${idempotentCheck.segments.length}`);
    }
    if (Math.abs(idempotentCheck.accumulatedMinutes - updated.accumulatedMinutes) > 0.05) {
      throw new Error(`Minutes inflated on repeated sync! Expected ${updated.accumulatedMinutes}, got ${idempotentCheck.accumulatedMinutes}`);
    }

    await WorkSession.findByIdAndDelete(baseSess._id);
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
