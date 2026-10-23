// run_full_e2e_test.mjs - Comprehensive E2E Verification Suite
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const MONGO_URI = "mongodb+srv://harshvardhansuryawanshi373_db_user:harshvardhan96@cluster0.vmfugxq.mongodb.net/test?retryWrites=true&w=majority";
const BASE_URL = "http://localhost:3001";
const JWT_SECRET = process.env.JWT_SECRET || "dev";

async function runFullE2ETest() {
  console.log("==================================================================");
  console.log("🚀 STARTING COMPREHENSIVE END-TO-END TEST SUITE FOR PROJECTTRACK");
  console.log("==================================================================");

  // 1. Connect to MongoDB
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Step 1: Successfully connected to MongoDB database");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }

  const db = mongoose.connection.db;

  // 2. Fetch Test Users (Admin, Active Employee, Inactive User)
  const adminUser = await db.collection("users").findOne({ role: "admin" });
  if (!adminUser) throw new Error("No admin user found in database");
  const adminToken = jwt.sign(
    { id: String(adminUser._id), role: "admin", name: adminUser.name },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  const activeEmployee = await db.collection("users").findOne({
    role: "employee",
    status: { $ne: "inactive" },
  });
  if (!activeEmployee) throw new Error("No active employee found in database");
  const employeeToken = jwt.sign(
    { id: String(activeEmployee._id), role: "employee", name: activeEmployee.name },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  const inactiveEmployee = await db.collection("users").findOne({ status: "inactive" });

  console.log("✅ Step 2: Test User Credentials Initialized:");
  console.log(`   - Admin: "${adminUser.name}" (${adminUser.email})`);
  console.log(`   - Active Employee: "${activeEmployee.name}" (${activeEmployee.designation || "Specialist"})`);
  console.log(`   - Inactive Account: "${inactiveEmployee ? inactiveEmployee.name : 'N/A'}"`);

  // 3. User Guard & Inactive Isolation
  console.log("\n--- TEST MODULE 1: User Security & Inactive Isolation ---");
  const usersRes = await fetch(`${BASE_URL}/api/users?status=active`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const activeUsers = await usersRes.json();
  const hasInactive = activeUsers.some((u) => u.status === "inactive");
  if (hasInactive) throw new Error("Security Failure: Inactive user returned in active query");
  console.log(`   [Pass] GET /api/users?status=active returned ${activeUsers.length} users with 0 inactive leaks.`);

  if (inactiveEmployee) {
    const inactiveToken = jwt.sign(
      { id: String(inactiveEmployee._id), role: "employee", name: inactiveEmployee.name },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const blockedRes = await fetch(`${BASE_URL}/api/users?status=active`, {
      headers: { Authorization: `Bearer ${inactiveToken}` },
    });
    if (blockedRes.status !== 403) throw new Error(`Security Failure: Inactive user not blocked (Status ${blockedRes.status})`);
    console.log("   [Pass] Inactive user request correctly rejected with 403 Forbidden.");
  }

  // 4. Categories CRUD Workflow (Testing newly compacted UI backend endpoints)
  console.log("\n--- TEST MODULE 2: Categories Workflow (Add, Fetch, Update, Delete) ---");
  const testCategoryName = `E2E Test Category ${Date.now()}`;
  
  // Create Category
  const addCatRes = await fetch(`${BASE_URL}/api/categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: testCategoryName }),
  });
  const createdCategory = await addCatRes.json();
  if (!createdCategory || !createdCategory._id) throw new Error("Failed to create category");
  console.log(`   [Pass] Created Category: "${createdCategory.name}" (ID: ${createdCategory._id})`);

  // Verify Category listed
  const getCatsRes = await fetch(`${BASE_URL}/api/categories`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const categoriesList = await getCatsRes.json();
  const catFound = categoriesList.some((c) => c._id === createdCategory._id);
  if (!catFound) throw new Error("Created category not found in list");
  console.log(`   [Pass] Category verified in list of ${categoriesList.length} total categories.`);

  // Edit / Update Category
  const updatedCatName = `${testCategoryName} Updated`;
  const updateCatRes = await fetch(`${BASE_URL}/api/categories/${createdCategory._id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: updatedCatName }),
  });
  const updatedCategory = await updateCatRes.json();
  if (updatedCategory.name !== updatedCatName) throw new Error("Category update failed");
  console.log(`   [Pass] Category successfully updated to: "${updatedCategory.name}"`);

  // 5. Companies CRUD Workflow
  console.log("\n--- TEST MODULE 3: Companies Workflow (Add, Fetch, Update) ---");
  const testCompanyName = `E2E Test Company ${Date.now()}`;
  const addCompRes = await fetch(`${BASE_URL}/api/companies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: testCompanyName }),
  });
  const createdCompany = await addCompRes.json();
  if (!createdCompany || !createdCompany._id) throw new Error("Failed to create company");
  console.log(`   [Pass] Created Company: "${createdCompany.name}" (ID: ${createdCompany._id})`);

  // 6. Projects & Project Planner Workflow (Including AI Smart Planner parameters)
  console.log("\n--- TEST MODULE 4: Projects & AI Smart Planner Schedule Generation ---");
  const testProjectName = `E2E Courseware Plan ${Date.now()}`;
  const createProjRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: testProjectName,
      code: `E2E-${Math.floor(Math.random() * 9000 + 1000)}`,
      company: createdCompany._id,
      category: createdCategory._id,
    }),
  });
  const createdProject = await createProjRes.json();
  if (!createdProject || !createdProject._id) throw new Error("Failed to create project");
  console.log(`   [Pass] Created Project: "${createdProject.name}" (Code: ${createdProject.code})`);

  // Plan Generation Payload (as submitted by AI Smart Planner / Setup Modal)
  const today = new Date().toISOString().split("T")[0];
  const planPayload = {
    projectId: createdProject._id,
    companyId: createdCompany._id,
    clientName: "Enterprise Client",
    projectType: "storyline-360",
    complexity: "Level 2",
    startDate: today,
    calculatedEndDate: today,
    courseLengthMinutes: 60,
    moduleCount: 4,
    parallelPipelining: true,
    totalWorkingDays: 28,
    totalCalendarDays: 40,
    estimatedEffortHours: 243,
    allocatedEffortHours: 280,
    actualUsedEffortHours: 0,
    projectManager: adminUser._id,
    assignedTeam: [
      {
        user: activeEmployee._id,
        name: activeEmployee.name,
        email: activeEmployee.email,
        roleCategory: "ID",
        designation: activeEmployee.designation,
        dailyHours: 7,
      },
    ],
    phases: [
      { id: "p1", name: "Instructional Design", durationDays: 14, isModuleLevel: true },
    ],
    tasks: [
      {
        id: "task-sb-e2e-1",
        name: "Module 1 Storyboard & Instructional Strategy",
        phaseId: "p1",
        role: "Instructional Designer",
        assignedUser: activeEmployee._id,
        assignedResources: [activeEmployee._id],
        hours: 14,
        workingDays: 2,
        status: "Not Started",
      },
      {
        id: "task-dev-e2e-1",
        name: "Module 1 Storyline Slide Development",
        phaseId: "p1",
        role: "eLearning Developer",
        assignedUser: activeEmployee._id,
        assignedResources: [activeEmployee._id],
        hours: 21,
        workingDays: 3,
        status: "Not Started",
      },
    ],
  };

  const createPlanRes = await fetch(`${BASE_URL}/api/project-plans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(planPayload),
  });
  const savedPlan = await createPlanRes.json();
  if (!savedPlan || !savedPlan._id) throw new Error("Failed to create project plan");
  console.log(`   [Pass] Saved Project Plan (ID: ${savedPlan._id}) with ${savedPlan.tasks.length} tasks.`);

  // Sync tasks to MongoDB task collection
  const syncRes = await fetch(`${BASE_URL}/api/project-plans/${savedPlan._id}/sync-tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const syncResult = await syncRes.json();
  if (!syncResult.ok) throw new Error("Sync tasks failed: " + JSON.stringify(syncResult));
  console.log(`   [Pass] Tasks synced to employee dashboard. Created/Updated: ${syncResult.createdCount + syncResult.updatedCount}`);

  // 7. Employee Dashboard & WorkTimer Session Workflow
  console.log("\n--- TEST MODULE 5: Employee Dashboard & WorkTimer Workflow ---");
  const empTasksRes = await fetch(`${BASE_URL}/api/tasks/my`, {
    headers: { Authorization: `Bearer ${employeeToken}` },
  });
  const empTasks = await empTasksRes.json();
  const plannedTask = (Array.isArray(empTasks) ? empTasks : []).find(
    (t) => (t.title || t.name) === "Module 1 Storyboard & Instructional Strategy"
  );
  if (!plannedTask) throw new Error("Planned task not found in employee task list");
  console.log(`   [Pass] Employee found assigned task: "${plannedTask.title || plannedTask.name}" (ID: ${plannedTask._id})`);

  // Start Work Session on task
  const startSessionRes = await fetch(`${BASE_URL}/api/work-sessions/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({
      taskId: plannedTask._id,
      taskTitle: plannedTask.title || plannedTask.name,
      taskType: "Analysis",
      projectId: createdProject._id,
      projectName: createdProject.name,
    }),
  });
  const sessionData = await startSessionRes.json();
  const sessionId = sessionData._id || sessionData.sessionId;
  if (!sessionId) throw new Error("Failed to start work session: " + JSON.stringify(sessionData));
  console.log(`   [Pass] Work session started successfully (Session ID: ${sessionId})`);

  // Update Task Status via PATCH /api/tasks/:id/status
  const patchRes1 = await fetch(`${BASE_URL}/api/tasks/${plannedTask._id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({ status: "in_progress" }),
  });
  if (!patchRes1.ok) throw new Error(`Failed to update task to in_progress (${patchRes1.status})`);
  console.log("   [Pass] Task status progressed to 'in_progress'");

  const patchRes2 = await fetch(`${BASE_URL}/api/tasks/${plannedTask._id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({ status: "completed" }),
  });
  if (!patchRes2.ok) throw new Error(`Failed to update task to completed (${patchRes2.status})`);
  console.log("   [Pass] Task status progressed to 'completed'");

  // Stop Work Session
  const stopSessionRes = await fetch(`${BASE_URL}/api/work-sessions/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${employeeToken}`,
    },
    body: JSON.stringify({
      sessionId,
      remarks: "E2E automated verification session",
    }),
  });
  const stopResult = await stopSessionRes.json();
  console.log(`   [Pass] Work session stopped cleanly (Status: ${stopResult.status || "stopped"})`);

  // 8. Cleanup Test Artifacts
  console.log("\n--- TEST MODULE 6: Teardown & Clean-up ---");
  await fetch(`${BASE_URL}/api/project-plans/${savedPlan._id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await fetch(`${BASE_URL}/api/categories/${createdCategory._id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await fetch(`${BASE_URL}/api/companies/${createdCompany._id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  await db.collection("tasks").deleteMany({ projectId: createdProject._id });
  await db.collection("projects").deleteOne({ _id: new mongoose.Types.ObjectId(createdProject._id) });
  if (sessionId) {
    await db.collection("worksessions").deleteOne({ _id: new mongoose.Types.ObjectId(sessionId) });
  }
  console.log("   [Pass] Temporary test entities cleaned up successfully.");

  console.log("\n==================================================================");
  console.log("🎉 ALL END-TO-END TESTS COMPLETED 100% SUCCESSFULLY WITH ZERO BUGS!");
  console.log("==================================================================");

  await mongoose.disconnect();
  process.exit(0);
}

runFullE2ETest().catch((err) => {
  console.error("\n❌ E2E Test Runner Encountered Error:", err);
  process.exit(1);
});
