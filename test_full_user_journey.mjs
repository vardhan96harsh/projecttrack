// backend/test_full_user_journey.mjs
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
import Project from "./models/Project.js";

import dns from "node:dns";
try { dns.setServers(["8.8.8.8", "1.1.1.1"]); } catch (e) {}
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function ymd(d = new Date()) {
  const istDate = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
}

async function runFullUserJourney() {
  console.log("=========================================================================");
  console.log("🚀 WORKTRACKER END-TO-END COMPLETE USER JOURNEY TEST");
  console.log("=========================================================================\n");

  // 1. Connect MongoDB
  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";
  await mongoose.connect(MONGO);
  console.log("✓ Connected to Database.\n");

  // 2. Setup isolated Express App on test port
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

  const server = app.listen(PORT);
  console.log(`✓ Test Server live on ${BASE}\n`);

  let stepNumber = 1;
  let passedSteps = 0;
  let createdSessionId = null;
  let createdRemarkId = null;
  let testEmployee = null;

  function assertStep(condition, message) {
    if (condition) {
      console.log(`  ✅ STEP ${stepNumber}: PASS - ${message}`);
      passedSteps++;
    } else {
      console.error(`  ❌ STEP ${stepNumber}: FAIL - ${message}`);
      throw new Error(`Journey aborted at step ${stepNumber}: ${message}`);
    }
    stepNumber++;
  }

  try {
    // -------------------------------------------------------------
    // PHASE 1: Find Active Admin & Create Isolated Test Employee
    // -------------------------------------------------------------
    console.log("--- PHASE 1: Authentication & Role Verification ---");

    const admin = await User.findOne({ role: "admin", status: "active" }).lean();
    if (!admin) {
      throw new Error("Missing active admin user in database.");
    }

    const testEmpEmail = `journey_audit_${Date.now()}@testcorp.com`;
    testEmployee = await User.create({
      name: "Alex Rivera (QA Auditor)",
      email: testEmpEmail,
      passwordHash: "audit_dummy_hash",
      role: "employee",
      status: "active",
      designation: "Storyline Developer",
    });

    const employeeToken = jwt.sign(
      { id: testEmployee._id, role: testEmployee.role, name: testEmployee.name },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    const adminToken = jwt.sign(
      { id: admin._id, role: admin.role, name: admin.name },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    assertStep(!!employeeToken, `Employee "${testEmployee.name}" successfully authenticated`);
    assertStep(!!adminToken, `Admin "${admin.name}" successfully authenticated for monitoring`);

    // -------------------------------------------------------------
    // PHASE 2: Project Selection
    // -------------------------------------------------------------
    console.log("\n--- PHASE 2: Project Selection & Task Lookup ---");

    const projRes = await fetch(`${BASE}/api/projects`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const projects = await projRes.json();
    assertStep(Array.isArray(projects) && projects.length > 0, `Employee queried project directory (${projects.length} available)`);

    const selectedProject = projects[0];
    const taskName = "Journey Functional Audit Task";
    assertStep(!!selectedProject._id, `Selected Project: "${selectedProject.name}" (ID: ${selectedProject._id})`);

    // -------------------------------------------------------------
    // PHASE 3: Work Timer - Session Start
    // -------------------------------------------------------------
    console.log("\n--- PHASE 3: Timer Start & Active Tracking ---");

    const todayStr = ymd(new Date());
    const startRes = await fetch(`${BASE}/api/work-sessions/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${employeeToken}`,
      },
      body: JSON.stringify({
        projectId: selectedProject._id,
        customTask: taskName,
        taskType: "Alpha",
        date: todayStr,
      }),
    });
    const startData = await startRes.json();
    const sessId = startData._id || startData.session?._id;
    assertStep(startRes.status === 200 && !!sessId, `Timer started with active session ID: ${sessId}`);
    createdSessionId = sessId;

    // Verify session state in DB
    const runningSession = await WorkSession.findById(createdSessionId).lean();
    assertStep(runningSession.status === "active", "Session status is verified as 'active'");

    // -------------------------------------------------------------
    // PHASE 4: Session Pause (Break Initiation)
    // -------------------------------------------------------------
    console.log("\n--- PHASE 4: Pausing Session & Reason Recording ---");

    const pauseRes = await fetch(`${BASE}/api/work-sessions/pause`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${employeeToken}`,
      },
      body: JSON.stringify({
        sessionId: createdSessionId,
        remarks: "Mid-morning Discussion & Research Break",
      }),
    });
    assertStep(pauseRes.status === 200, "Session successfully transitioned to 'paused'");

    const pausedSession = await WorkSession.findById(createdSessionId).lean();
    assertStep(pausedSession.status === "paused", "Database reflects status: 'paused'");

    // -------------------------------------------------------------
    // PHASE 5: Admin Paused Session Notifier (AdminPausedSessionNotifier)
    // -------------------------------------------------------------
    console.log("\n--- PHASE 5: Admin Notifier Alert Trigger Verification ---");

    // Simulate 20 minutes of pause time by adjusting pausedAt and segments
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    const dbSess = await WorkSession.findById(createdSessionId);
    if (dbSess) {
      dbSess.pausedAt = twentyMinsAgo;
      dbSess.date = todayStr;
      if (dbSess.segments && dbSess.segments.length > 0) {
        dbSess.segments[dbSess.segments.length - 1].end = twentyMinsAgo;
      }
      await dbSess.save();
    }

    const alertsRes = await fetch(`${BASE}/api/work-sessions/admin/paused-alerts?minMinutes=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const alertsData = await alertsRes.json();
    assertStep(alertsRes.status === 200 && Array.isArray(alertsData.alerts), "Admin polled /api/work-sessions/admin/paused-alerts");

    const targetAlert = alertsData.alerts.find(
      (a) => String(a.userId) === String(testEmployee._id) || String(a.sessionId) === String(createdSessionId)
    );
    assertStep(!!targetAlert, `AdminPausedSessionNotifier detected paused employee: "${targetAlert?.employeeName}"`);
    assertStep(targetAlert?.pausedMinutes >= 10, `Alert shows correct paused duration (${targetAlert?.pausedMinutes} mins >= 10m threshold)`);

    // -------------------------------------------------------------
    // PHASE 6: Session Resume & Stop
    // -------------------------------------------------------------
    console.log("\n--- PHASE 6: Resuming & Finalizing Work Session ---");

    // Start/Resume session
    const resumeRes = await fetch(`${BASE}/api/work-sessions/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${employeeToken}`,
      },
      body: JSON.stringify({
        projectId: selectedProject._id,
        customTask: taskName,
        taskType: "Alpha",
      }),
    });
    assertStep(resumeRes.status === 200, "Employee resumed work on task");

    // Stop session
    const stopRes = await fetch(`${BASE}/api/work-sessions/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${employeeToken}`,
      },
      body: JSON.stringify({
        sessionId: createdSessionId,
        remarks: "Completed first audit milestone",
      }),
    });
    assertStep(stopRes.status === 200, "Employee finalized and stopped session");

    // -------------------------------------------------------------
    // PHASE 7: Manual Time Request & Admin Approval
    // -------------------------------------------------------------
    console.log("\n--- PHASE 7: Manual Remark Request & Admin Review ---");

    const remarkRes = await fetch(`${BASE}/api/manual-remarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${employeeToken}`,
      },
      body: JSON.stringify({
        date: todayStr,
        requestedMinutes: 45,
        text: "Offline Project Architecture Documentation",
        projectId: selectedProject._id,
        taskType: "Alpha",
      }),
    });
    const remarkData = await remarkRes.json();
    assertStep(remarkRes.status === 200 && !!remarkData._id, `Manual time request created for 45 minutes (ID: ${remarkData._id})`);
    createdRemarkId = remarkData._id;

    // Admin verifies pending count
    const pendingRes = await fetch(`${BASE}/api/manual-remarks/admin/pending-count`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pendingData = await pendingRes.json();
    assertStep(pendingData.count > 0, `Admin pending review queue shows ${pendingData.count} pending requests`);

    // Admin approves the request
    const approveRes = await fetch(`${BASE}/api/manual-remarks/${createdRemarkId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    assertStep(approveRes.status === 200, "Admin successfully approved the manual time remark");

    const approvedRemark = await ManualRemark.findById(createdRemarkId).lean();
    assertStep(approvedRemark.status === "approved", "Remark status transitioned to 'approved'");

    // -------------------------------------------------------------
    // PHASE 8: Timesheet & Daily Report Verification
    // -------------------------------------------------------------
    console.log("\n--- PHASE 8: Timesheet & Daily Report Data Verification ---");

    // Employee views their sessions
    const mySessionsRes = await fetch(`${BASE}/api/work-sessions/my?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const mySessions = await mySessionsRes.json();
    assertStep(Array.isArray(mySessions), `Employee retrieved personal timesheet records (${mySessions.length} sessions logged)`);

    // Admin verifies daily report summary
    const summaryRes = await fetch(`${BASE}/api/reports/summary?from=${todayStr}&to=${todayStr}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const summaryData = await summaryRes.json();
    assertStep(summaryRes.status === 200 && Array.isArray(summaryData), "Admin successfully loaded Daily Report summary");

    console.log("\n=========================================================================");
    console.log(`🎉 FULL USER JOURNEY SUCCESSFUL: ALL ${passedSteps} STEPS PASSED WITHOUT ERROR`);
    console.log("=========================================================================\n");

  } finally {
    // -------------------------------------------------------------
    // PHASE 9: Cleanup
    // -------------------------------------------------------------
    console.log("--- CLEANUP: Removing Test Artifacts ---");
    if (createdSessionId) {
      await WorkSession.findByIdAndDelete(createdSessionId);
      console.log(`  ✓ Removed test work session (${createdSessionId})`);
    }
    if (createdRemarkId) {
      await ManualRemark.findByIdAndDelete(createdRemarkId);
      console.log(`  ✓ Removed test manual remark (${createdRemarkId})`);
    }
    if (testEmployee?._id) {
      await User.findByIdAndDelete(testEmployee._id);
      console.log(`  ✓ Removed test employee (${testEmployee._id})`);
    }

    server.close();
    await mongoose.disconnect();
    console.log("  ✓ Closed test server and database connection.\n");
  }
}

runFullUserJourney().catch((err) => {
  console.error("\n💥 User Journey test failed with error:", err.message);
  process.exit(1);
});
