// Comprehensive End-to-End Verification Test Script
import mongoose from "mongoose";

const BASE = "http://localhost:3001";

async function run() {
  console.log("=================================================");
  console.log("🚀 STARTING COMPREHENSIVE END-TO-END AUDIT SUITE");
  console.log("=================================================");

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

  try {
    // 1. Health check
    const healthRes = await fetch(`${BASE}/`);
    const health = await healthRes.json();
    assert(health.ok === true, "Health check responded ok: true");

    // 2. Auth - Admin Login
    let adminLoginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@demo.com", password: "Pass@123" }),
    });
    if (adminLoginRes.status !== 200) {
      adminLoginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "admin123" }),
      });
    }
    const adminAuth = await adminLoginRes.json();
    assert(adminLoginRes.status === 200 && adminAuth.token, "Admin logged in successfully");

    const adminToken = adminAuth.token;

    // 3. Inactive User Login Block
    const testInactiveEmail = `inactive_audit_${Date.now()}@example.com`;
    const createInactiveRes = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "Test Inactive User",
        email: testInactiveEmail,
        password: "password123",
        role: "employee",
        status: "inactive",
        dob: new Date().toISOString(),
      }),
    });
    const inactiveUser = await createInactiveRes.json();

    const inactiveLoginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inactiveUser.email, password: "password123" }),
    });
    assert(inactiveLoginRes.status === 403, "Inactive user login blocked with HTTP 403");

    // 4. Birthday endpoint excludes inactive users
    const bdayRes = await fetch(`${BASE}/api/users/birthdays/today`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const bdays = await bdayRes.json();
    assert(Array.isArray(bdays), "Birthdays endpoint returned array");
    const containsInactive = bdays.some((b) => b.id === inactiveUser._id || b.name === inactiveUser.name);
    assert(!containsInactive, "Today birthdays strictly excludes inactive users");

    // 5. Create Dedicated Test Employee (Never touch or mutate real employee data)
    const testEmployeeEmail = `test_employee_${Date.now()}@e2e-audit.test`;
    const createEmpRes = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: "E2E Audit Test Employee",
        email: testEmployeeEmail,
        password: "password123",
        role: "employee",
        status: "active",
        dob: new Date("1995-05-15").toISOString(),
      }),
    });
    const activeEmployee = await createEmpRes.json();
    assert(activeEmployee && (activeEmployee._id || activeEmployee.id), "Dedicated test employee created");

    const empLogin = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmployeeEmail, password: "password123" }),
    });
    const empAuth = await empLogin.json();
    const employeeToken = empAuth.token;
    assert(empLogin.status === 200 && employeeToken, "Dedicated test employee authenticated");

    // 6. Companies & Projects
    const compRes = await fetch(`${BASE}/api/companies`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const companies = await compRes.json();
    let company = companies[0];

    const catRes = await fetch(`${BASE}/api/categories`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const categories = await catRes.json();
    let category = categories[0];

    // Create a dedicated test project for plan verification
    const testProjectName = `E2E Audit Project ${Date.now()}`;
    const projCreateRes = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: testProjectName,
        code: `E2E-${Date.now().toString().slice(-4)}`,
        company: company._id,
        category: category._id,
      }),
    });
    const testProject = await projCreateRes.json();
    assert(projCreateRes.status === 201 && testProject._id, `Created test project "${testProjectName}"`);

    // 7. Project Plan Creation & Auto-Sync
    const planPayload = {
      projectId: testProject._id,
      companyId: company._id,
      clientName: "Global E2E Enterprise Client",
      projectType: "eLearning Courseware",
      complexity: "Level 2 (Standard)",
      moduleCount: 2,
      courseLengthMinutes: 45,
      startDate: new Date().toISOString(),
      calculatedEndDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      totalWorkingDays: 10,
      estimatedEffortHours: 120,
      allocatedEffortHours: 120,
      actualUsedEffortHours: 0,
      assignedTeam: [
        {
          roleCategory: "Instructional Design",
          user: activeEmployee?._id || activeEmployee?.id,
          allocationPercentage: 100,
        },
        {
          roleCategory: "QA & Testing",
          user: inactiveUser?._id || inactiveUser?.id, // Should be excluded from assignment!
          allocationPercentage: 50,
        },
      ],
      tasks: [
        {
          id: "T1",
          name: "Curriculum Needs Analysis",
          role: "Lead Instructional Designer",
          roleCategory: "Instructional Design",
          hours: 16,
          durationWorkingDays: 2,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
          status: "Not Started",
          assignedResources: [activeEmployee?._id || activeEmployee?.id],
        },
        {
          id: "T2",
          name: "Quality Assurance & Signoff",
          role: "Quality Assurance Specialist",
          roleCategory: "QA & Testing",
          hours: 8,
          durationWorkingDays: 1,
          startDate: new Date(Date.now() + 3 * 86400000).toISOString(),
          endDate: new Date(Date.now() + 4 * 86400000).toISOString(),
          status: "Not Started",
          assignedResources: [inactiveUser?._id || inactiveUser?.id], // Inactive user
        },
      ],
    };

    const savePlanRes = await fetch(`${BASE}/api/project-plans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(planPayload),
    });
    const savedPlan = await savePlanRes.json();
    assert(savePlanRes.status === 200 && savedPlan._id, "Project plan created and saved successfully");

    // 8. Explicit Task Sync
    const syncRes = await fetch(`${BASE}/api/project-plans/${savedPlan._id}/sync-tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const syncResult = await syncRes.json();
    assert(syncResult.ok === true, "Explicit sync tasks returned ok: true");

    // 9. Verify generated tasks in Task collection
    const projectTasksRes = await fetch(`${BASE}/api/tasks?projectId=${testProject._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const projectTasks = await projectTasksRes.json();
    assert(projectTasks.length === 2, "Synced exactly 2 tasks to Task collection");

    const t1 = projectTasks.find((t) => t.title === "Curriculum Needs Analysis");
    const t2 = projectTasks.find((t) => t.title === "Quality Assurance & Signoff");

    assert(t1 && t1.assignedTo?.some((u) => (u._id || u) == (activeEmployee?._id || activeEmployee?.id)), "Task 1 assigned to active employee");
    assert(t2 && (!t2.assignedTo || !t2.assignedTo.some((u) => (u._id || u) == (inactiveUser?._id || inactiveUser?.id))), "Task 2 excluded inactive user from assignedTo");

    // 10. Employee Task Management
    if (employeeToken && t1) {
      const myCountRes = await fetch(`${BASE}/api/tasks/my/count`, {
        headers: { Authorization: `Bearer ${employeeToken}` },
      });
      const countData = await myCountRes.json();
      assert(typeof countData.count === "number" && countData.count >= 1, "Employee task count returned >= 1");

      // Update task status to in_progress
      const patchProgRes = await fetch(`${BASE}/api/tasks/${t1._id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ status: "in_progress" }),
      });
      const patchedProg = await patchProgRes.json();
      assert(patchedProg.status === "in_progress", "Employee updated task status to in_progress");

      // Update task status to completed
      const patchCompRes = await fetch(`${BASE}/api/tasks/${t1._id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ status: "completed" }),
      });
      const patchedComp = await patchCompRes.json();
      assert(patchedComp.status === "completed", "Employee updated task status to completed");

      // Check that ProjectPlan syncStatusToProjectPlan updated actualUsedEffortHours
      const checkPlanRes = await fetch(`${BASE}/api/project-plans/${savedPlan._id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const updatedPlanDoc = await checkPlanRes.json();
      const planT1 = updatedPlanDoc.tasks?.find((t) => t.name === "Curriculum Needs Analysis");
      assert(planT1?.status === "Completed", "Task status synchronized back to ProjectPlan as 'Completed'");
      assert(Number(updatedPlanDoc.actualUsedEffortHours) >= 16, "ProjectPlan actualUsedEffortHours updated with completed task hours");
    }

    // 11. WorkSession Tracking
    if (employeeToken) {
      const sessionStartRes = await fetch(`${BASE}/api/work-sessions/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          projectId: testProject._id,
          taskType: "Analysis",
          taskTitle: "Curriculum Needs Analysis",
        }),
      });
      const startedSession = await sessionStartRes.json();
      assert(startedSession.status === "active", "Work session started successfully with status 'active'");

      // Pause session
      const sessionPauseRes = await fetch(`${BASE}/api/work-sessions/pause`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({}),
      });
      const pausedSession = await sessionPauseRes.json();
      assert(pausedSession.status === "paused", "Work session paused successfully");

      // Resume session
      const sessionResumeRes = await fetch(`${BASE}/api/work-sessions/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ sessionId: startedSession._id }),
      });
      const resumedSession = await sessionResumeRes.json();
      assert(resumedSession.status === "active", "Work session resumed successfully");

      // Stop session
      const sessionStopRes = await fetch(`${BASE}/api/work-sessions/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({ remarks: "Completed module analysis verification" }),
      });
      const stoppedSession = await sessionStopRes.json();
      assert(stoppedSession.status === "stopped", "Work session stopped and finalized");
    }

    // 12. Manual Time Requests Flow with Full Remark Text
    if (employeeToken) {
      const longRemarkText = "Conducted in-depth offline curriculum review with client stakeholders for module 1. Reviewed 45 slides and revised learning objectives according to Bloom's taxonomy.";
      const createRemarkRes = await fetch(`${BASE}/api/manual-remarks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${employeeToken}`,
        },
        body: JSON.stringify({
          project: testProject._id,
          text: longRemarkText,
          customTask: "Offline Curriculum Review",
          requestedMinutes: 90,
          taskType: "Analysis",
          date: new Date().toISOString().slice(0, 10),
        }),
      });
      const createdRemark = await createRemarkRes.json();
      assert(createdRemark._id && createdRemark.status === "pending", "Submitted manual time request with custom task and full remark");

      // Admin lists manual remarks
      const adminRemarksRes = await fetch(`${BASE}/api/manual-remarks/admin`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const adminRemarks = await adminRemarksRes.json();
      const foundRemark = adminRemarks.find((r) => r._id === createdRemark._id);
      assert(foundRemark && foundRemark.text === longRemarkText, "Admin retrieved manual request with complete un-truncated text");
      assert(foundRemark && foundRemark.customTask === "Offline Curriculum Review", "Admin retrieved customTask properly");

      // Admin updates minutes
      const updateMinRes = await fetch(`${BASE}/api/manual-remarks/${createdRemark._id}/update-minutes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ requestedMinutes: 120 }),
      });
      const updatedMin = await updateMinRes.json();
      assert(updatedMin.requestedMinutes === 120, "Admin adjusted requested minutes to 120m");

      // Admin approves request
      const approveRes = await fetch(`${BASE}/api/manual-remarks/${createdRemark._id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const approvedResult = await approveRes.json();
      assert(approvedResult.success === true && approvedResult.remark?.status === "approved", "Admin approved manual time request");
    }

    // 13. Reports Export & Breakdown
    const summaryReportRes = await fetch(`${BASE}/api/reports/summary?dim=project`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const summaryData = await summaryReportRes.json();
    assert(summaryReportRes.status === 200 && Array.isArray(summaryData), "Reports summary API returned aggregated project rows");

    const exportRes = await fetch(`${BASE}/api/reports/export`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const csvText = await exportRes.text();
    assert(csvText.includes('"Date","Employee","Company","Category","Project","Task Type","Hours","Remarks"'), "CSV Export header matches RFC 4180 format with UTF-8 BOM");

    // 14. Project Plan Deletion & Task Cleanup
    const deletePlanRes = await fetch(`${BASE}/api/project-plans/${savedPlan._id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const deleteResult = await deletePlanRes.json();
    assert(deleteResult.ok === true, "Project plan deleted successfully");

    // Verify plan is gone
    const checkDeletedRes = await fetch(`${BASE}/api/project-plans/${savedPlan._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(checkDeletedRes.status === 404, "Deleted project plan returns 404 Not Found");

    // Verify completed tasks are preserved and uncompleted tasks deleted
    const remainingTasksRes = await fetch(`${BASE}/api/tasks?projectId=${testProject._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const remainingTasks = await remainingTasksRes.json();
    const remainingT1 = remainingTasks.find((t) => t.title === "Curriculum Needs Analysis");
    const remainingT2 = remainingTasks.find((t) => t.title === "Quality Assurance & Signoff");

    assert(remainingT1 && remainingT1.status === "completed", "Completed task was safely preserved after plan deletion");
    assert(!remainingT2, "Uncompleted/pending task was cleanly removed after plan deletion");

    // 15. Teardown: Clean up test users and test entities
    const empId = activeEmployee._id || activeEmployee.id;
    if (empId) {
      await fetch(`${BASE}/api/users/${empId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
    const inactiveId = inactiveUser._id || inactiveUser.id;
    if (inactiveId) {
      await fetch(`${BASE}/api/users/${inactiveId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
    console.log("  ✅ PASS: Test employee and test inactive user cleaned up");

    console.log("=================================================");
    console.log(`🏁 AUDIT COMPLETED: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("FATAL AUDIT ERROR:", err);
    process.exit(1);
  }
}

run();
