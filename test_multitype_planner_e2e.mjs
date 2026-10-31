// backend/test_multitype_planner_e2e.mjs
import dns from "node:dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Ignore if not supported in environment
}

import assert from "assert";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// Import Planner Engines
import { CalendarEngine } from "../frontend/src/plannerEngine/calendarEngine.js";
import { EstimationEngine } from "../frontend/src/plannerEngine/estimationEngine.js";
import { SchedulerEngine } from "../frontend/src/plannerEngine/schedulerEngine.js";
import { DEFAULT_TEMPLATES, getCombinedTemplate } from "../frontend/src/plannerEngine/defaultTemplates.js";
import { PROJECT_TYPE_COMPLEXITIES, DEFAULT_COMPLEXITY_CONFIG } from "../frontend/src/plannerEngine/complexityConfig.js";

// Import Backend Routes & Models
import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import categoryRoutes from "./routes/categories.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import projectPlanRoutes from "./routes/projectPlans.js";
import taskRoutes from "./routes/tasks.js";

import User from "./models/User.js";
import Company from "./models/Company.js";
import Category from "./models/Category.js";
import Project from "./models/Project.js";
import ProjectPlan from "./models/ProjectPlan.js";
import Task from "./models/Task.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

let totalPassed = 0;
let totalFailed = 0;

function runSyncTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    totalFailed++;
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    totalFailed++;
    throw err;
  }
}

async function runEndToEndSuite() {
  console.log("=========================================================================");
  console.log("🧪 MULTI-TYPE PROJECT PLANNER & COMPLEXITY END-TO-END VALIDATION");
  console.log("=========================================================================\n");

  // =====================================================================
  // SECTION 1: UNIT & ENGINE LEVEL VERIFICATION
  // =====================================================================
  console.log("--- SECTION 1: Template & Planner Engine Logic ---");

  runSyncTest("getCombinedTemplate for single type returns standard template", () => {
    const single = getCombinedTemplate(["storyline-360"]);
    assert.strictEqual(single.id, "storyline-360");
    assert.strictEqual(single.phases.length, 7);
  });

  runSyncTest("getCombinedTemplate for all 4 deliverables (Storyline, Rise, Video, PDF)", () => {
    const allTypes = ["storyline-360", "rise-360", "mp4-video", "pdf-graphic"];
    const combined = getCombinedTemplate(allTypes);
    assert(combined.name.includes("Storyline"), "Name includes Storyline");
    assert(combined.name.includes("Rise"), "Name includes Rise");
    assert(combined.name.includes("Video"), "Name includes Video");
    assert(combined.name.includes("PDF"), "Name includes PDF");
    assert.strictEqual(combined.phases.length, 7, "Combined template structured in 7 core phases");

    // Phase 4 (Dev) should contain tasks for Storyline, Rise, Video, and PDF
    const devPhase = combined.phases.find((p) => p.id === "phase-development" || p.id === "phase-dev");
    assert(devPhase, "Phase 4 (phase-development) exists");
    const devTaskNames = devPhase.tasks.map((t) => t.name);
    assert(devTaskNames.some((n) => n.includes("Storyline")), "Has Storyline dev tasks");
    assert(devTaskNames.some((n) => n.includes("Rise 360")), "Has Rise 360 dev tasks");
    assert(devTaskNames.some((n) => n.includes("Video") || n.includes("Motion")), "Has Video dev tasks");
    assert(devTaskNames.some((n) => n.includes("PDF") || n.includes("Typesetting")), "Has PDF dev tasks");
  });

  runSyncTest("EstimationEngine calculates & sums hours for multiple deliverables", () => {
    const singleStoryline = EstimationEngine.calculateBreakdown({
      projectTypes: ["storyline-360"],
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 2"
    });

    const multiAll = EstimationEngine.calculateBreakdown({
      projectTypes: ["storyline-360", "rise-360", "mp4-video", "pdf-graphic"],
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 2"
    });

    assert(
      multiAll.hours.grandTotalHours > singleStoryline.hours.grandTotalHours,
      `Multi-deliverable plan effort (${multiAll.hours.grandTotalHours}h) must exceed single deliverable effort (${singleStoryline.hours.grandTotalHours}h)`
    );
  });

  runSyncTest("Complexity Levels scale effort cleanly without (1x)/(2x) label leakage", () => {
    const levels = PROJECT_TYPE_COMPLEXITIES["storyline-360"];
    const names = levels.map((l) => l.name);
    assert.deepStrictEqual(names, ["Level 1", "Level 2", "Level 2.5", "Level 3", "Level 4"]);

    // Verify effort scaling
    const lvl1 = EstimationEngine.calculateBreakdown({
      projectTypes: ["storyline-360"],
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 1"
    });
    const lvl4 = EstimationEngine.calculateBreakdown({
      projectTypes: ["storyline-360"],
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 4"
    });
    assert(lvl4.hours.grandTotalHours > lvl1.hours.grandTotalHours, "Level 4 effort > Level 1 effort");
  });

  runSyncTest("SchedulerEngine generates multi-type schedule with tasks across all deliverables", () => {
    const allTypes = ["storyline-360", "rise-360", "mp4-video", "pdf-graphic"];
    const schedule = SchedulerEngine.generateSchedule({
      projectId: "e2e-proj-1",
      projectName: "Multi-Track Masterclass",
      clientName: "Global Learning Corp",
      projectTypes: allTypes,
      complexity: "Level 2",
      courseLengthMinutes: 60,
      moduleCount: 4,
      startDate: "2026-11-02",
      assignedTeam: [
        { id: "u-id-1", name: "Jane ID", roleCategory: "ID", dailyHours: 7 },
        { id: "u-dev-1", name: "Bob Dev", roleCategory: "DEVELOPER", dailyHours: 7 },
        { id: "u-anim-1", name: "Sam Animator", roleCategory: "ANIMATOR", dailyHours: 7 },
        { id: "u-qa-1", name: "Quinn QA", roleCategory: "QA", dailyHours: 7 },
      ]
    });

    assert.deepStrictEqual(schedule.projectTypes, allTypes, "Schedule preserves projectTypes array");
    assert(schedule.tasks.length > 20, "Tasks generated for all deliverables across modules");
    assert(schedule.totalWorkingDays > 0, "Working days calculated");
    assert(schedule.calculatedEndDate, "Calculated end date present");

    // Check deliverable representation in tasks
    const hasStorylineTasks = schedule.tasks.some((t) => t.name.toLowerCase().includes("storyline"));
    const hasRiseTasks = schedule.tasks.some((t) => t.name.toLowerCase().includes("rise"));
    const hasVideoTasks = schedule.tasks.some((t) => t.name.toLowerCase().includes("video"));
    const hasPdfTasks = schedule.tasks.some((t) => t.name.toLowerCase().includes("pdf"));

    assert(hasStorylineTasks, "Schedule contains Storyline tasks");
    assert(hasRiseTasks, "Schedule contains Rise tasks");
    assert(hasVideoTasks, "Schedule contains Video tasks");
    assert(hasPdfTasks, "Schedule contains PDF tasks");
  });

  // =====================================================================
  // SECTION 2: LIVE BACKEND API & MONGODB END-TO-END TESTS
  // =====================================================================
  console.log("\n--- SECTION 2: Live Backend API & Database Persistence ---");

  const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";
  await mongoose.connect(MONGO);
  console.log("  ✓ MongoDB connected.\n");

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use("/api/auth", authRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/categories", categoryRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/project-plans", projectPlanRoutes);
  app.use("/api/tasks", taskRoutes);

  const server = app.listen(PORT);
  console.log(`  ✓ Test server live on ${BASE}\n`);

  let testAdmin = null;
  let adminToken = null;
  let testCompany = null;
  let testCategory = null;
  let testProject = null;
  let testIdUser = null;
  let testDevUser = null;
  let testQaUser = null;
  let createdPlanId = null;

  try {
    // 1. Setup Admin Token
    testAdmin = await User.findOne({ role: "admin", status: "active" }).lean();
    if (!testAdmin) {
      testAdmin = await User.create({
        name: "Test Admin",
        email: `planner_admin_${Date.now()}@test.com`,
        passwordHash: "dummyhash",
        role: "admin",
        status: "active",
      });
    }
    adminToken = jwt.sign({ id: String(testAdmin._id), role: "admin", name: testAdmin.name }, JWT_SECRET, { expiresIn: "1h" });

    // 2. Setup Team Members with specific designations
    const timeStamp = Date.now();
    testIdUser = await User.create({
      name: "Instructional Designer User",
      email: `id_${timeStamp}@test.com`,
      passwordHash: "hash",
      role: "employee",
      designation: "Instructional Designer",
      status: "active",
    });

    testDevUser = await User.create({
      name: "Storyline Developer User",
      email: `dev_${timeStamp}@test.com`,
      passwordHash: "hash",
      role: "employee",
      designation: "Storyline Developer",
      status: "active",
    });

    testQaUser = await User.create({
      name: "Quality Analyst User",
      email: `qa_${timeStamp}@test.com`,
      passwordHash: "hash",
      role: "employee",
      designation: "Quality Analyst",
      status: "active",
    });

    // 3. Create Company & Category & Project
    testCompany = await Company.create({ name: `Test Enterprise Org ${timeStamp}` });
    testCategory = await Category.create({ name: `eLearning Division ${timeStamp}`, company: testCompany._id });
    testProject = await Project.create({
      name: `Multi-Track Flagship Course ${timeStamp}`,
      code: `MT-${String(timeStamp).slice(-4)}`,
      company: testCompany._id,
      category: testCategory._id,
      status: "active",
    });

    // 4. Test POST /api/project-plans with all 4 Deliverable Types
    await runAsyncTest("API: POST /api/project-plans creates multi-deliverable plan in DB", async () => {
      const allTypes = ["storyline-360", "rise-360", "mp4-video", "pdf-graphic"];
      const generated = SchedulerEngine.generateSchedule({
        projectId: String(testProject._id),
        projectName: testProject.name,
        clientName: "Enterprise Client",
        projectTypes: allTypes,
        complexity: "Level 2",
        courseLengthMinutes: 60,
        moduleCount: 4,
        startDate: "2026-11-02",
        projectManager: testAdmin,
        assignedTeam: [
          { user: testIdUser._id, name: testIdUser.name, roleCategory: "ID", dailyHours: 7 },
          { user: testDevUser._id, name: testDevUser.name, roleCategory: "DEVELOPER", dailyHours: 7 },
          { user: testQaUser._id, name: testQaUser.name, roleCategory: "QA", dailyHours: 7 },
        ],
      });

      const payload = {
        projectId: String(testProject._id),
        companyId: String(testCompany._id),
        clientName: "Enterprise Global Client",
        projectType: allTypes.join(", "),
        projectTypes: allTypes,
        complexity: "Level 2",
        startPhaseId: generated.startPhaseId,
        startPhaseName: generated.startPhaseName,
        startDate: generated.startDate,
        calculatedEndDate: generated.calculatedEndDate,
        courseLengthMinutes: 60,
        moduleCount: 4,
        parallelPipelining: true,
        includeHld: false,
        totalWorkingDays: generated.totalWorkingDays,
        totalCalendarDays: generated.totalCalendarDays,
        nonWorkingDays: generated.nonWorkingDays,
        estimatedEffortHours: generated.estimatedEffortHours,
        allocatedEffortHours: generated.allocatedEffortHours,
        actualUsedEffortHours: 0,
        projectManager: String(testAdmin._id),
        assignedTeam: generated.assignedTeam,
        phases: generated.phases,
        tasks: generated.tasks,
        manualOverrides: {},
        complexityConfig: DEFAULT_COMPLEXITY_CONFIG,
      };

      const res = await fetch(`${BASE}/api/project-plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });

      assert(res.status === 200 || res.status === 201, `Expected status 200 or 201, got ${res.status}`);
      const saved = await res.json();
      assert(saved._id, "Plan ID returned");
      createdPlanId = saved._id;

      // Verify DB persistence of projectTypes array and projectType string
      const dbPlan = await ProjectPlan.findById(saved._id).lean();
      assert(dbPlan, "Plan found in database");
      assert.deepStrictEqual(dbPlan.projectTypes, allTypes, "dbPlan.projectTypes contains all 4 types");
      assert(dbPlan.projectType.includes("storyline-360"), "dbPlan.projectType string has storyline");
      assert(dbPlan.projectType.includes("rise-360"), "dbPlan.projectType string has rise");
      assert(dbPlan.projectType.includes("mp4-video"), "dbPlan.projectType string has video");
      assert(dbPlan.projectType.includes("pdf-graphic"), "dbPlan.projectType string has pdf");
      assert.strictEqual(dbPlan.complexity, "Level 2", "Complexity stored as Level 2");
    });

    // 5. Test GET /api/project-plans retrieves multi-type plans correctly
    await runAsyncTest("API: GET /api/project-plans returns plans with projectTypes intact", async () => {
      const res = await fetch(`${BASE}/api/project-plans`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
      const plans = await res.json();
      const match = plans.find((p) => String(p._id) === String(createdPlanId));
      assert(match, "Created plan is in plans list");
      assert(Array.isArray(match.projectTypes), "projectTypes is an array");
      assert.strictEqual(match.projectTypes.length, 4, "All 4 types present in GET response");
    });

    // 6. Test Task Collection Sync & Role-Based Visibility (Ensuring Related Task Filtering Works!)
    await runAsyncTest("Task Sync: Developer only assigned developer tasks, ID only assigned ID tasks", async () => {
      const syncedTasks = await Task.find({ project: testProject._id }).lean();
      assert(syncedTasks.length > 0, "Tasks were synced to Task collection");

      // Verify that tasks assigned to testDevUser are NOT ID tasks or QA tasks
      const devTasks = syncedTasks.filter((t) => String(t.assignedTo) === String(testDevUser._id));
      assert(devTasks.length > 0, "Developer has assigned tasks");
      for (const t of devTasks) {
        const title = t.title.toLowerCase();
        assert(
          !title.includes("script") && !title.includes("storyboard") && !title.includes("outline") && !title.includes("curriculum") && !title.includes("kickoff"),
          `Developer should NOT be assigned ID task: ${t.title}`
        );
        assert(
          !title.includes("qa signoff") && !title.includes("internal layout & typography qa"),
          `Developer should NOT be assigned QA task: ${t.title}`
        );
      }

      // Verify that tasks assigned to testIdUser are solely ID tasks and NOT Developer or QA tasks
      const idTasks = syncedTasks.filter((t) => String(t.assignedTo) === String(testIdUser._id));
      assert(idTasks.length > 0, "Instructional Designer has assigned tasks");
      for (const t of idTasks) {
        const title = t.title.toLowerCase();
        assert(
          !title.includes("interactive slide programming") && !title.includes("typesetting") && !title.includes("interactive block assembly") && !title.includes("scorm packaging"),
          `ID should NOT be assigned Dev programming task: ${t.title}`
        );
        assert(
          !title.includes("functional, scorm & a11y qa") && !title.includes("cross-device & mobile responsiveness qa"),
          `ID should NOT be assigned QA task: ${t.title}`
        );
      }
    });

  } finally {
    // Cleanup created test records
    console.log("\n--- Cleaning up test records ---");
    if (createdPlanId) await ProjectPlan.findByIdAndDelete(createdPlanId);
    if (testProject?._id) {
      await Task.deleteMany({ project: testProject._id });
      await Project.findByIdAndDelete(testProject._id);
    }
    if (testCategory?._id) await Category.findByIdAndDelete(testCategory._id);
    if (testCompany?._id) await Company.findByIdAndDelete(testCompany._id);
    if (testIdUser?._id) await User.findByIdAndDelete(testIdUser._id);
    if (testDevUser?._id) await User.findByIdAndDelete(testDevUser._id);
    if (testQaUser?._id) await User.findByIdAndDelete(testQaUser._id);
    if (testAdmin?._id && testAdmin.email.startsWith("planner_admin_")) {
      await User.findByIdAndDelete(testAdmin._id);
    }

    server.close();
    await mongoose.disconnect();
    console.log("  ✓ Test server closed & MongoDB disconnected.\n");
  }

  console.log("=========================================================================");
  console.log(`🏁 END-TO-END VALIDATION SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("=========================================================================\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runEndToEndSuite().catch((err) => {
  console.error("FATAL ERROR in E2E Suite:", err);
  process.exit(1);
});
