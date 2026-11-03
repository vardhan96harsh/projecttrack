// backend/test_full_admin_journey.mjs
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
import projectPlanRoutes from "./routes/projectPlans.js";
import taskRoutes from "./routes/tasks.js";

// Models for cleanup
import Company from "./models/Company.js";
import Category from "./models/Category.js";
import Project from "./models/Project.js";
import User from "./models/User.js";
import ProjectPlan from "./models/ProjectPlan.js";
import Task from "./models/Task.js";
import WorkSession from "./models/WorkSession.js";
import ManualRemark from "./models/ManualRemark.js";

// Planner Engine for Plan generation
import { SchedulerEngine } from "../frontend/src/plannerEngine/schedulerEngine.js";

dotenv.config();

const PORT = 3096;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function ymd(d = new Date()) {
  const istDate = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
}

async function runFullAdminJourney() {
  console.log("=========================================================================");
  console.log("👑 WORKTRACKER END-TO-END COMPLETE ADMIN MANAGEMENT JOURNEY");
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
  app.use("/api/project-plans", projectPlanRoutes);
  app.use("/api/tasks", taskRoutes);

  const server = app.listen(PORT);
  console.log(`✓ Test Server live on ${BASE}\n`);

  let stepNumber = 1;
  let passedSteps = 0;

  // Cleanup trackers
  let createdCompanyId = null;
  let createdCategoryId = null;
  let createdProjectId = null;
  let createdUserId = null;
  let createdPlanId = null;
  let createdRemarkId = null;

  function assertStep(condition, message) {
    if (condition) {
      console.log(`  ✅ STEP ${stepNumber}: PASS - ${message}`);
      passedSteps++;
    } else {
      console.error(`  ❌ STEP ${stepNumber}: FAIL - ${message}`);
      throw new Error(`Admin Journey aborted at step ${stepNumber}: ${message}`);
    }
    stepNumber++;
  }

  try {
    // -------------------------------------------------------------
    // PHASE 1: Admin Authentication & Permission Verification
    // -------------------------------------------------------------
    console.log("--- PHASE 1: Admin Authentication & Role Privileges ---");

    const admin = await User.findOne({ role: "admin", status: "active" }).lean();
    if (!admin) {
      throw new Error("Missing active admin user in database.");
    }

    const adminToken = jwt.sign(
      { id: admin._id, role: admin.role, name: admin.name },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    assertStep(!!adminToken, `Admin "${admin.name}" successfully authenticated with JWT`);

    // Verify admin can fetch users list
    const usersRes = await fetch(`${BASE}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const usersList = await usersRes.json();
    assertStep(usersRes.status === 200 && Array.isArray(usersList), `Admin authorized to view user directory (${usersList.length} users registered)`);

    // -------------------------------------------------------------
    // PHASE 2: Organization Master Setup (Company & Category)
    // -------------------------------------------------------------
    console.log("\n--- PHASE 2: Client Company & Category Creation ---");

    const uniqueTag = Date.now().toString().slice(-5);
    const testCompanyName = `Global Tech Solutions ${uniqueTag}`;
    const testCategoryName = `Interactive Simulations ${uniqueTag}`;

    // Create Company
    const compRes = await fetch(`${BASE}/api/companies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: testCompanyName }),
    });
    const createdComp = await compRes.json();
    assertStep(compRes.status === 201 && !!createdComp._id, `Created Client Company: "${createdComp.name}" (ID: ${createdComp._id})`);
    createdCompanyId = createdComp._id;

    // Create Category
    const catRes = await fetch(`${BASE}/api/categories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: testCategoryName }),
    });
    const createdCat = await catRes.json();
    assertStep(catRes.status === 201 && !!createdCat._id, `Created Project Category: "${createdCat.name}" (ID: ${createdCat._id})`);
    createdCategoryId = createdCat._id;

    // -------------------------------------------------------------
    // PHASE 3: Project Provisioning
    // -------------------------------------------------------------
    console.log("\n--- PHASE 3: Project Provisioning & Code Generation ---");

    const projCode = `GTS-${uniqueTag}`;
    const projName = `Enterprise Compliance Training ${uniqueTag}`;
    const projRes = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: projName,
        code: projCode,
        company: createdCompanyId,
        category: createdCategoryId,
        description: "Admin End-to-End Simulation Courseware Project",
        status: "active",
      }),
    });
    const createdProject = await projRes.json();
    assertStep(projRes.status === 201 && !!createdProject._id, `Project provisioned: "${createdProject.name}" [Code: ${createdProject.code}]`);
    createdProjectId = createdProject._id;

    // -------------------------------------------------------------
    // PHASE 4: Employee Onboarding & Account Provisioning
    // -------------------------------------------------------------
    console.log("\n--- PHASE 4: Team Member Onboarding & Role Assignment ---");

    const empEmail = `audited_engineer_${uniqueTag}@testcorp.com`;
    const userCreateRes = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "David Miller (Courseware Dev)",
        email: empEmail,
        password: "TemporaryPassword123!",
        role: "employee",
        status: "active",
        designation: "Storyline Developer",
        employeeId: `EMP-${uniqueTag}`,
      }),
    });
    const createdUser = await userCreateRes.json();
    assertStep((userCreateRes.status === 200 || userCreateRes.status === 201) && (createdUser._id || createdUser.id), `Provisioned Employee Account: "${createdUser.name}" [${createdUser.email}]`);
    createdUserId = createdUser._id || createdUser.id;

    // -------------------------------------------------------------
    // PHASE 5: Project Plan Generation & Task Sync
    // -------------------------------------------------------------
    console.log("\n--- PHASE 5: Planning Engine & Automatic Task Distribution ---");

    const schedule = SchedulerEngine.generateSchedule({
      projectId: createdProjectId,
      projectName: projName,
      projectType: "storyline-360",
      complexity: "Level 2",
      courseLengthMinutes: 45,
      moduleCount: 3,
      includeHld: false,
      startDate: ymd(new Date()),
      assignedTeam: [
        { name: "David Miller", roleCategory: "DEVELOPER", dailyHours: 7, user: createdUserId }
      ],
    });
    assertStep(schedule.tasks.length > 0, `Scheduler Engine generated ${schedule.tasks.length} tasks across ${schedule.phases.length} phases`);

    // Admin saves project plan to backend
    const planRes = await fetch(`${BASE}/api/project-plans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        projectId: createdProjectId,
        companyId: createdCompanyId,
        clientName: testCompanyName,
        projectType: "storyline-360",
        complexity: "Level 2",
        includeHld: false,
        courseLengthMinutes: 45,
        moduleCount: 3,
        startDate: ymd(new Date()),
        phases: schedule.phases,
        tasks: schedule.tasks,
        totalWorkingDays: schedule.totalWorkingDays,
        estimatedEffortHours: schedule.estimatedEffortHours,
      }),
    });
    const savedPlan = await planRes.json();
    assertStep(planRes.status === 200 && !!savedPlan._id, `Saved ProjectPlan to MongoDB (Total Effort: ${savedPlan.estimatedEffortHours} hrs)`);
    createdPlanId = savedPlan._id;

    // Verify task collection automatically synced non-client tasks
    const tasksRes = await fetch(`${BASE}/api/tasks?projectId=${createdProjectId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const syncedTasks = await tasksRes.json();
    assertStep(Array.isArray(syncedTasks) && syncedTasks.length > 0, `Tasks collection verified: ${syncedTasks.length} tasks automatically generated for project`);

    // -------------------------------------------------------------
    // PHASE 6: Operational Supervision & Live Reports Inspection
    // -------------------------------------------------------------
    console.log("\n--- PHASE 6: Live Operational Monitoring & Alerts ---");

    const todayStr = ymd(new Date());

    // Check Daily Report Session List
    const dailyReportRes = await fetch(`${BASE}/api/work-sessions/admin/list?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const dailyReport = await dailyReportRes.json();
    assertStep(dailyReportRes.status === 200, `Admin viewed Live Daily Report for date: ${todayStr}`);

    // Check Paused Alerts
    const alertsRes = await fetch(`${BASE}/api/work-sessions/admin/paused-alerts?minMinutes=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const alertsData = await alertsRes.json();
    assertStep(alertsRes.status === 200 && Array.isArray(alertsData.alerts), `Admin successfully monitored paused session alerts`);

    // -------------------------------------------------------------
    // PHASE 7: Reviewing & Approving Employee Time Adjustments
    // -------------------------------------------------------------
    console.log("\n--- PHASE 7: Reviewing & Approving Manual Requests ---");

    // Simulate employee submission
    const pendingRemark = await ManualRemark.create({
      user: createdUserId,
      project: createdProjectId,
      date: todayStr,
      requestedMinutes: 60,
      text: "Interactive Prototype Review with Client Stakeholders",
      taskType: "Alpha",
      status: "pending",
    });
    createdRemarkId = pendingRemark._id;

    // Admin checks pending requests count
    const pendingCountRes = await fetch(`${BASE}/api/manual-remarks/admin/pending-count`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const countData = await pendingCountRes.json();
    assertStep(countData.count > 0, `Pending review queue shows ${countData.count} pending items awaiting admin decision`);

    // Admin approves the request
    const approveRes = await fetch(`${BASE}/api/manual-remarks/${createdRemarkId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    assertStep(approveRes.status === 200, `Admin approved 60-min manual remark for "${pendingRemark.text}"`);

    const checkRemark = await ManualRemark.findById(createdRemarkId).lean();
    assertStep(checkRemark.status === "approved", "Remark state verified as 'approved' in database");

    // -------------------------------------------------------------
    // PHASE 8: Reports, Summary & Data Export
    // -------------------------------------------------------------
    console.log("\n--- PHASE 8: Management Reports & Timesheet Audit ---");

    const summaryRes = await fetch(`${BASE}/api/reports/summary?from=${todayStr}&to=${todayStr}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const summaryData = await summaryRes.json();
    assertStep(summaryRes.status === 200 && Array.isArray(summaryData), "Generated Admin Summary Report across active teams");

    const exportRes = await fetch(`${BASE}/api/reports/export?from=${todayStr}&to=${todayStr}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const csvExport = await exportRes.text();
    assertStep(exportRes.status === 200 && csvExport.length > 0, `Exported management timesheet data (${csvExport.split("\n").length} rows)`);

    console.log("\n=========================================================================");
    console.log(`🎉 FULL ADMIN JOURNEY SUCCESSFUL: ALL ${passedSteps} STEPS PASSED WITHOUT ERROR`);
    console.log("=========================================================================\n");

  } finally {
    // -------------------------------------------------------------
    // PHASE 9: Cleanup
    // -------------------------------------------------------------
    console.log("--- CLEANUP: Removing Admin Test Artifacts ---");
    if (createdRemarkId) {
      await ManualRemark.findByIdAndDelete(createdRemarkId);
      console.log(`  ✓ Removed test manual remark (${createdRemarkId})`);
    }
    if (createdPlanId) {
      await ProjectPlan.findByIdAndDelete(createdPlanId);
      console.log(`  ✓ Removed test project plan (${createdPlanId})`);
    }
    if (createdProjectId) {
      await Task.deleteMany({ project: createdProjectId });
      await Project.findByIdAndDelete(createdProjectId);
      console.log(`  ✓ Removed test project & synced tasks (${createdProjectId})`);
    }
    if (createdCompanyId) {
      await Company.findByIdAndDelete(createdCompanyId);
      console.log(`  ✓ Removed test company (${createdCompanyId})`);
    }
    if (createdCategoryId) {
      await Category.findByIdAndDelete(createdCategoryId);
      console.log(`  ✓ Removed test category (${createdCategoryId})`);
    }
    if (createdUserId) {
      await User.findByIdAndDelete(createdUserId);
      console.log(`  ✓ Removed test user (${createdUserId})`);
    }

    server.close();
    await mongoose.disconnect();
    console.log("  ✓ Closed test server and database connection.\n");
  }
}

runFullAdminJourney().catch((err) => {
  console.error("\n💥 Admin Journey test failed with error:", err.message);
  process.exit(1);
});
