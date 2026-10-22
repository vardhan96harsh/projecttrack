// backend/verify_storyline_7phase_plan.mjs
import { SchedulerEngine } from "../frontend/src/plannerEngine/schedulerEngine.js";
import { DEFAULT_TEMPLATES } from "../frontend/src/plannerEngine/defaultTemplates.js";

const BASE = "http://localhost:3001";

async function runAudit() {
  console.log("=================================================");
  console.log("🧪 STORYLINE 360 7-PHASE PLAN COMPREHENSIVE AUDIT");
  console.log("=================================================\n");

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

  // ─────────────────────────────────────────────
  // 1. Template Definition Check
  // ─────────────────────────────────────────────
  console.log("📌 1. Verifying Template Specification (defaultTemplates.js):");
  const storylineTpl = DEFAULT_TEMPLATES.find((t) => t.id === "storyline-360");
  assert(!!storylineTpl, "storyline-360 template exists in DEFAULT_TEMPLATES");
  assert(storylineTpl.phases.length === 7, `Template has exactly 7 phases (got ${storylineTpl?.phases.length})`);

  const p1 = storylineTpl.phases[0];
  assert(p1.id === "phase-initiation", `Phase 1 ID is phase-initiation`);
  assert(p1.tasks.length === 2, `Phase 1 has strictly 2 tasks (got ${p1.tasks.length})`);
  assert(p1.tasks[0].id === "task-kickoff", `Phase 1 Task 1 is task-kickoff`);
  assert(p1.tasks[1].id === "task-req-analysis", `Phase 1 Task 2 is task-req-analysis`);

  const p2 = storylineTpl.phases[1];
  assert(p2.tasks[0].id === "task-script-dev", `Phase 2 Task 1 is task-script-dev`);
  assert(p2.tasks[1].id === "task-storyboard-dev", `Phase 2 Task 2 is task-storyboard-dev`);

  const p3 = storylineTpl.phases[2];
  assert(p3.tasks.some((t) => t.id === "task-client-asset-approval"), `Phase 3 includes task-client-asset-approval`);

  const p4 = storylineTpl.phases[3];
  assert(p4.tasks.some((t) => t.id === "task-hld-concept"), `Phase 4 includes conditional task-hld-concept`);
  assert(p4.tasks.some((t) => t.id === "task-client-hld"), `Phase 4 includes conditional task-client-hld`);

  // ─────────────────────────────────────────────
  // 2. Schedule Engine: Standard (includeHld = false)
  // ─────────────────────────────────────────────
  console.log("\n📌 2. Verifying Schedule Generation (includeHld = false):");
  const schedWithoutHld = SchedulerEngine.generateSchedule({
    projectId: "test-proj-no-hld",
    projectName: "Storyline Standard Course",
    projectType: "storyline-360",
    complexity: "Level 2",
    courseLengthMinutes: 60,
    moduleCount: 4,
    includeHld: false,
    startDate: "2026-10-26",
    assignedTeam: [
      { name: "Harsh (PM)", roleCategory: "PM", dailyHours: 7 },
      { name: "Alice (ID)", roleCategory: "ID", dailyHours: 7 },
      { name: "Bob (Dev)", roleCategory: "DEVELOPER", dailyHours: 7 },
      { name: "Carol (Designer)", roleCategory: "DESIGNER", dailyHours: 7 },
      { name: "Dave (Animator)", roleCategory: "ANIMATOR", dailyHours: 7 },
      { name: "Eve (QA)", roleCategory: "QA", dailyHours: 7 },
    ],
  });

  assert(schedWithoutHld.tasks.length > 0, `Schedule generated ${schedWithoutHld.tasks.length} total tasks`);

  // Check Phase 1 tasks
  const p1Tasks = schedWithoutHld.tasks.filter((t) => t.phaseId === "phase-1");
  assert(p1Tasks.length === 2, `Phase 1 in generated schedule has strictly 2 tasks (got ${p1Tasks.length})`);
  assert(p1Tasks[0].id === "phase-1-task-kickoff", `Phase 1 Task 1 id is phase-1-task-kickoff`);
  assert(p1Tasks[1].id === "phase-1-task-req-analysis", `Phase 1 Task 2 id is phase-1-task-req-analysis`);

  // Check that HLD tasks are omitted in Phase 4 when includeHld = false
  const hasHldConcept = schedWithoutHld.tasks.some((t) => t.id.includes("task-hld-concept"));
  const hasClientHld = schedWithoutHld.tasks.some((t) => t.id.includes("task-client-hld"));
  assert(!hasHldConcept, "task-hld-concept is omitted when includeHld = false");
  assert(!hasClientHld, "task-client-hld is omitted when includeHld = false");

  // Check Phase 2 task-script-dev dependency
  const mod1Script = schedWithoutHld.tasks.find((t) => t.id === "mod-1-task-script-dev");
  assert(!!mod1Script, "Module 1 task-script-dev exists");
  assert(mod1Script.dependencies.includes("phase-1-task-req-analysis"), "Module 1 script-dev depends on phase-1-task-req-analysis");

  // Check Phase 4 animation and storyline dev depend on task-client-asset-approval
  const mod1Anim = schedWithoutHld.tasks.find((t) => t.id === "mod-1-task-2d-anim");
  const mod1Dev = schedWithoutHld.tasks.find((t) => t.id === "mod-1-task-storyline-dev");
  assert(mod1Anim.dependencies.includes("mod-1-task-client-asset-approval"), "Module 1 2D Anim depends on mod-1-task-client-asset-approval");
  assert(mod1Dev.dependencies.includes("mod-1-task-client-asset-approval"), "Module 1 Storyline Dev depends on mod-1-task-client-asset-approval");

  // Check date propagation integrity (no NaN or invalid dates)
  let dateErrors = 0;
  for (const t of schedWithoutHld.tasks) {
    if (!t.startDate || !t.endDate || isNaN(new Date(t.startDate).getTime()) || isNaN(new Date(t.endDate).getTime())) {
      dateErrors++;
    }
    if (new Date(t.startDate) > new Date(t.endDate)) {
      dateErrors++;
    }
  }
  assert(dateErrors === 0, `All ${schedWithoutHld.tasks.length} task dates are valid and start <= end`);

  // Check dependency ordering: prerequisite end <= dependent start
  let dependencyOrderErrors = 0;
  const taskMap = new Map(schedWithoutHld.tasks.map((t) => [t.id, t]));
  for (const t of schedWithoutHld.tasks) {
    for (const depId of t.dependencies || []) {
      const parent = taskMap.get(depId);
      if (parent) {
        if (new Date(parent.endDate) > new Date(t.startDate)) {
          dependencyOrderErrors++;
        }
      }
    }
  }
  assert(dependencyOrderErrors === 0, `Dependency chain verified: parent.endDate <= dependent.startDate for all tasks`);

  // ─────────────────────────────────────────────
  // 3. Schedule Engine: Conditional HLD (includeHld = true)
  // ─────────────────────────────────────────────
  console.log("\n📌 3. Verifying Schedule Generation (includeHld = true):");
  const schedWithHld = SchedulerEngine.generateSchedule({
    projectId: "test-proj-with-hld",
    projectName: "Storyline Prototype Course",
    projectType: "storyline-360",
    complexity: "Level 2",
    courseLengthMinutes: 60,
    moduleCount: 4,
    includeHld: true,
    startDate: "2026-10-26",
    assignedTeam: [
      { name: "Harsh (PM)", roleCategory: "PM", dailyHours: 7 },
      { name: "Alice (ID)", roleCategory: "ID", dailyHours: 7 },
      { name: "Bob (Dev)", roleCategory: "DEVELOPER", dailyHours: 7 },
    ],
  });

  const mod1HldConcept = schedWithHld.tasks.find((t) => t.id === "mod-1-task-hld-concept");
  const mod1ClientHld = schedWithHld.tasks.find((t) => t.id === "mod-1-task-client-hld");
  assert(!!mod1HldConcept, "mod-1-task-hld-concept exists when includeHld = true");
  assert(!!mod1ClientHld, "mod-1-task-client-hld exists when includeHld = true");
  assert(mod1HldConcept.dependencies.includes("mod-1-task-client-asset-approval"), "mod-1-task-hld-concept depends on mod-1-task-client-asset-approval");
  assert(mod1ClientHld.dependencies.includes("mod-1-task-hld-concept"), "mod-1-task-client-hld depends on mod-1-task-hld-concept");

  const mod1AnimHld = schedWithHld.tasks.find((t) => t.id === "mod-1-task-2d-anim");
  const mod1DevHld = schedWithHld.tasks.find((t) => t.id === "mod-1-task-storyline-dev");
  assert(mod1AnimHld.dependencies.includes("mod-1-task-client-hld"), "mod-1-task-2d-anim depends on mod-1-task-client-hld");
  assert(mod1DevHld.dependencies.includes("mod-1-task-client-hld"), "mod-1-task-storyline-dev depends on mod-1-task-client-hld");

  // ─────────────────────────────────────────────
  // 4. Backend API End-to-End Persistence Check
  // ─────────────────────────────────────────────
  console.log("\n📌 4. Verifying Backend API & Database Persistence:");
  try {
    // Login as admin
    let loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@demo.com", password: "Pass@123" }),
    });
    if (loginRes.status !== 200) {
      loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "admin123" }),
      });
    }
    const authData = await loginRes.json();
    assert(loginRes.status === 200 && authData.token, "Admin authenticated with backend API");
    const token = authData.token;

    // Get a company & category for testing
    const compRes = await fetch(`${BASE}/api/companies`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const companies = await compRes.json();
    const testCompany = companies[0] || null;

    const catRes = await fetch(`${BASE}/api/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const categories = await catRes.json();
    const testCategory = categories[0] || null;

    if (testCompany && testCategory) {
      // Create a test project
      const projCode = `AUDIT-${Date.now().toString().slice(-4)}`;
      const createProjRes = await fetch(`${BASE}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: "Storyline 360 Plan Verification Project",
          code: projCode,
          company: testCompany._id,
          category: testCategory._id,
        }),
      });
      const testProject = await createProjRes.json();
      assert(createProjRes.status === 201 && testProject._id, `Created test project ${testProject.code}`);

      // Save a plan with includeHld = false
      const savePlanRes = await fetch(`${BASE}/api/project-plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: testProject._id,
          companyId: testCompany._id,
          clientName: "Audit Test Client",
          projectType: "storyline-360",
          complexity: "Level 2",
          includeHld: false,
          courseLengthMinutes: 60,
          moduleCount: 4,
          startDate: "2026-10-26",
          phases: schedWithoutHld.phases,
          tasks: schedWithoutHld.tasks,
          totalWorkingDays: schedWithoutHld.totalWorkingDays,
          estimatedEffortHours: schedWithoutHld.estimatedEffortHours,
        }),
      });
      const savedPlan = await savePlanRes.json();
      assert(savePlanRes.status === 200 && savedPlan._id, "Saved ProjectPlan with includeHld = false");
      assert(savedPlan.includeHld === false, "savedPlan.includeHld persisted as false");

      // Verify tasks synced to Task collection
      const tasksRes = await fetch(`${BASE}/api/tasks?projectId=${testProject._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const syncedTasks = await tasksRes.json();
      assert(syncedTasks.length > 0, `Automatically synced ${syncedTasks.length} non-client tasks into Task collection`);

      // Verify Phase 1 task in Task collection
      const kickoffTask = syncedTasks.find((t) => t.title.includes("Project Kickoff & Alignment"));
      assert(!!kickoffTask, "Project Kickoff task synced to Task collection");

      // Update plan with includeHld = true
      const updatePlanRes = await fetch(`${BASE}/api/project-plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: testProject._id,
          companyId: testCompany._id,
          clientName: "Audit Test Client",
          projectType: "storyline-360",
          complexity: "Level 2",
          includeHld: true,
          courseLengthMinutes: 60,
          moduleCount: 4,
          startDate: "2026-10-26",
          phases: schedWithHld.phases,
          tasks: schedWithHld.tasks,
          totalWorkingDays: schedWithHld.totalWorkingDays,
          estimatedEffortHours: schedWithHld.estimatedEffortHours,
        }),
      });
      const updatedPlan = await updatePlanRes.json();
      assert(updatePlanRes.status === 200, "Updated ProjectPlan successfully");
      assert(updatedPlan.includeHld === true, "updatedPlan.includeHld persisted as true in MongoDB");

      // Clean up test project
      await fetch(`${BASE}/api/projects/${testProject._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log("  🧹 Test project cleaned up successfully");
    } else {
      console.warn("  ⚠️ Skipping backend DB test: no company/category found in DB");
    }
  } catch (apiErr) {
    console.error("  ❌ Backend API test failed:", apiErr.message);
    failed++;
  }

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────
  console.log("\n=================================================");
  console.log(`🏁 AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error("Audit crashed:", err);
  process.exit(1);
});
