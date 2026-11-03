// backend/test_missing_coverage_and_fixes.mjs
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Load routes
import authRoutes, { generateTokens } from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import categoryRoutes from "./routes/categories.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import reportRoutes from "./routes/reports.js";
import machinesRouter from "./routes/machines.js";
import workSessionsRouter from "./routes/workSessions.js";
import manualRemarkRoutes from "./routes/manualRemarks.js";
import holidayRoutes from "./routes/holidays.js";
import timesheetRoutes from "./routes/timesheets.js";

// Models
import User from "./models/User.js";
import Machine from "./models/Machine.js";
import Holiday from "./models/Holiday.js";
import Timesheet from "./models/Timesheet.js";
import Company from "./models/Company.js";
import Category from "./models/Category.js";
import Project from "./models/Project.js";
import WorkSession from "./models/WorkSession.js";

dotenv.config();

const PORT = 3094;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

async function runMissingCoverageTests() {
  console.log("=========================================================================");
  console.log("🔍 WORKTRACKER GAP AUDIT & MISSING COVERAGE TEST SUITE");
  console.log("=========================================================================\n");

  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack");
  console.log("✓ Connected to Database.\n");

  const app = express();
  app.use(cors());
  app.use(express.json());

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
  app.use("/api/timesheets", timesheetRoutes);

  const server = app.listen(PORT);
  console.log(`✓ Test Server live on ${BASE}\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  const uniqueTag = Date.now().toString().slice(-5);
  const createdUserIds = [];
  const createdHolidayIds = [];
  const createdTimesheetIds = [];
  const createdMachineIds = [];
  let testSessionId = null;

  try {
    // -----------------------------------------------------------------
    // 1. TIMESHEETS BUG FIX VERIFICATION (SuperAdmin & DateRange)
    // -----------------------------------------------------------------
    console.log("--- 1. Timesheets SuperAdmin Access & Date Boundary Fixes ---");

    const empUser = await User.create({
      name: "Timesheet Tester",
      email: `ts_emp_${uniqueTag}@test.com`,
      passwordHash: "hash",
      role: "employee",
      status: "active",
    });
    createdUserIds.push(empUser._id);

    const superUser = await User.create({
      name: "SuperAdmin TS Tester",
      email: `ts_super_${uniqueTag}@test.com`,
      passwordHash: "hash",
      role: "superadmin",
      status: "active",
    });
    createdUserIds.push(superUser._id);

    const company = await Company.findOne().lean();
    const category = await Category.findOne().lean();
    const project = await Project.findOne().lean();

    // Log a timesheet on today's afternoon
    const afternoonDate = new Date();
    afternoonDate.setHours(15, 30, 0, 0);

    const ts = await Timesheet.create({
      user: empUser._id,
      company: company?._id || new mongoose.Types.ObjectId(),
      category: category?._id || new mongoose.Types.ObjectId(),
      project: project?._id || new mongoose.Types.ObjectId(),
      taskType: "Alpha Development",
      hours: 4.5,
      remarks: "Afternoon deep dive",
      dateLogged: afternoonDate,
    });
    createdTimesheetIds.push(ts._id);

    const superToken = jwt.sign({ id: superUser._id, role: "superadmin" }, JWT_SECRET, { expiresIn: "1h" });
    const todayStr = afternoonDate.toISOString().slice(0, 10);

    // Super Admin queries timesheets with to=todayStr
    const tsRes = await fetch(`${BASE}/api/timesheets?to=${todayStr}&user=${empUser._id}`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const tsData = await tsRes.json();
    assert(tsRes.status === 200, "SuperAdmin successfully queries /api/timesheets");
    const foundTs = Array.isArray(tsData) && tsData.some((t) => String(t._id) === String(ts._id));
    assert(foundTs, "SuperAdmin can view employee timesheet logged later in the day (end-of-day boundary fix verified)");

    // -----------------------------------------------------------------
    // 2. AUTHENTICATION REFRESH TOKEN LIFECYCLE
    // -----------------------------------------------------------------
    console.log("\n--- 2. Auth Refresh Token Lifecycle & Rejection Guards ---");

    const tokens = generateTokens(empUser);
    assert(!!tokens.token && !!tokens.refreshToken, "generateTokens creates both token and refreshToken");

    // Valid refresh
    const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    const refreshData = await refreshRes.json();
    assert(refreshRes.status === 200 && !!refreshData.token, "POST /api/auth/refresh returns renewed access token");

    // Invalid refresh token
    const badRefreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "invalid.token.string" }),
    });
    assert(badRefreshRes.status === 401, "POST /api/auth/refresh rejects invalid refresh tokens (401)");

    // Missing refresh token
    const emptyRefreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(emptyRefreshRes.status === 400, "POST /api/auth/refresh rejects missing token payload (400)");

    // -----------------------------------------------------------------
    // 3. INACTIVE ACCOUNT REJECTION (Lockout Security)
    // -----------------------------------------------------------------
    console.log("\n--- 3. Inactive Account Lockout & Immediate Invalidation ---");

    const passHash = await bcrypt.hash("Pass1234!", 10);
    const deactivatedUser = await User.create({
      name: "Deactivated Worker",
      email: `deactivated_${uniqueTag}@test.com`,
      passwordHash: passHash,
      role: "employee",
      status: "inactive",
    });
    createdUserIds.push(deactivatedUser._id);

    // Login must be blocked
    const loginDeactivatedRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: deactivatedUser.email, password: "Pass1234!" }),
    });
    assert(loginDeactivatedRes.status === 403, "POST /api/auth/login rejects inactive accounts (403 Forbidden)");

    // Active token of inactive user must be rejected by middleware
    const staleToken = jwt.sign({ id: deactivatedUser._id, role: "employee" }, JWT_SECRET, { expiresIn: "1h" });
    const authCheckRes = await fetch(`${BASE}/api/work-sessions/my`, {
      headers: { Authorization: `Bearer ${staleToken}` },
    });
    assert(authCheckRes.status === 403, "requireAuth middleware immediately blocks requests from deactivated accounts");

    // -----------------------------------------------------------------
    // 4. MACHINE REGISTRATION & PING (Desktop Agent Integration)
    // -----------------------------------------------------------------
    console.log("\n--- 4. Machine Registration & Desktop Ping Endpoints ---");

    const testMachId = `WIN-AGENT-${uniqueTag}`;
    createdMachineIds.push(testMachId);

    // Register machine
    const regRes = await fetch(`${BASE}/api/machines/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineId: testMachId,
        hostname: "DESKTOP-AUDIT-PC",
        platform: "win32",
        agentVersion: "2.4.1",
      }),
    });
    const regData = await regRes.json();
    assert(regRes.status === 200 && !!regData.machineToken, "POST /api/machines/register assigns persistent machineToken");

    // Ping machine
    const pingRes = await fetch(`${BASE}/api/machines/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId: testMachId }),
    });
    const pingData = await pingRes.json();
    assert(pingRes.status === 200 && !!pingData.lastSeenAt, "POST /api/machines/ping updates lastSeenAt timestamp");

    // Missing machineId rejection
    const badPingRes = await fetch(`${BASE}/api/machines/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(badPingRes.status === 400, "POST /api/machines/ping rejects request missing machineId (400)");

    // -----------------------------------------------------------------
    // 5. HOLIDAYS ADMIN CRUD LIFECYCLE
    // -----------------------------------------------------------------
    console.log("\n--- 5. Holiday Management CRUD Lifecycle ---");

    // Create Holiday
    const holidayDate = `2029-01-${(parseInt(uniqueTag, 10) % 25 + 1).toString().padStart(2, "0")}`;
    const holCreateRes = await fetch(`${BASE}/api/holidays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superToken}`,
      },
      body: JSON.stringify({
        name: `Founders Day ${uniqueTag}`,
        date: holidayDate,
        type: "company",
      }),
    });
    const holData = await holCreateRes.json();
    assert(holCreateRes.status === 201 && !!holData._id, `POST /api/holidays creates holiday: "${holData.name}"`);
    createdHolidayIds.push(holData._id);

    // Duplicate date rejection test (Bug fix test)
    const duplicateHolRes = await fetch(`${BASE}/api/holidays`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superToken}`,
      },
      body: JSON.stringify({
        name: `Conflicting Holiday ${uniqueTag}`,
        date: holidayDate,
        type: "company",
      }),
    });
    assert(duplicateHolRes.status === 409, "POST /api/holidays rejects duplicate date with 409 Conflict (bug fixed)");

    // Edit Holiday
    const holEditRes = await fetch(`${BASE}/api/holidays/${holData._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superToken}`,
      },
      body: JSON.stringify({
        name: `Founders Gala ${uniqueTag}`,
        date: holidayDate,
        type: "public",
      }),
    });
    const editedHol = await holEditRes.json();
    assert(holEditRes.status === 200 && editedHol.name.includes("Founders Gala"), "PUT /api/holidays/:id updates holiday name and date");

    // Delete Holiday
    const holDelRes = await fetch(`${BASE}/api/holidays/${holData._id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${superToken}` },
    });
    assert(holDelRes.status === 200, "DELETE /api/holidays/:id deletes holiday cleanly");

    // -----------------------------------------------------------------
    // 6. SESSION HEARTBEAT
    // -----------------------------------------------------------------
    console.log("\n--- 6. Live Session Heartbeat Verification ---");

    const empToken = jwt.sign({ id: empUser._id, role: "employee" }, JWT_SECRET, { expiresIn: "1h" });

    // Start a session
    const startSessRes = await fetch(`${BASE}/api/work-sessions/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${empToken}`,
      },
      body: JSON.stringify({ customTask: "Heartbeat Test Task", taskType: "Alpha" }),
    });
    const sessObj = await startSessRes.json();
    testSessionId = sessObj._id || sessObj.session?._id;

    // Send Heartbeat
    const hbRes = await fetch(`${BASE}/api/work-sessions/heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const hbData = await hbRes.json();
    assert(hbRes.status === 200 && hbData.ok === true, "POST /api/work-sessions/heartbeat keeps active session alive");

    console.log("\n=========================================================================");
    console.log(`🏁 GAP AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log("=========================================================================\n");

    if (failed > 0) process.exit(1);

  } finally {
    console.log("--- CLEANUP: Removing Audit Artifacts ---");
    if (testSessionId) await WorkSession.findByIdAndDelete(testSessionId);
    if (createdHolidayIds.length > 0) await Holiday.deleteMany({ _id: { $in: createdHolidayIds } });
    if (createdTimesheetIds.length > 0) await Timesheet.deleteMany({ _id: { $in: createdTimesheetIds } });
    if (createdMachineIds.length > 0) await Machine.deleteMany({ machineId: { $in: createdMachineIds } });
    if (createdUserIds.length > 0) await User.deleteMany({ _id: { $in: createdUserIds } });

    server.close();
    await mongoose.disconnect();
    console.log("  ✓ Closed test server and database connection.\n");
  }
}

runMissingCoverageTests().catch((err) => {
  console.error("Audit crashed:", err);
  process.exit(1);
});
