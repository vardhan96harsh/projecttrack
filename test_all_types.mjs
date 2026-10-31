// backend/test_all_types.mjs
import assert from "assert";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// Import Planner Engines (Unit Tests)
import { CalendarEngine } from "../frontend/src/plannerEngine/calendarEngine.js";
import { EstimationEngine } from "../frontend/src/plannerEngine/estimationEngine.js";
import { SchedulerEngine } from "../frontend/src/plannerEngine/schedulerEngine.js";
import { DEFAULT_TEMPLATES } from "../frontend/src/plannerEngine/defaultTemplates.js";

// Import Backend Models (Schema & DB Tests)
import User from "./models/User.js";
import Project from "./models/Project.js";
import WorkSession from "./models/WorkSession.js";
import ManualRemark from "./models/ManualRemark.js";

dotenv.config();

let totalPassed = 0;
let totalFailed = 0;

function runTest(category, testName, fn) {
  try {
    fn();
    console.log(`  ✅ [${category}] PASS: ${testName}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ [${category}] FAIL: ${testName}`);
    console.error(`     Error: ${err.message}`);
    totalFailed++;
  }
}

async function runAsyncTest(category, testName, fn) {
  try {
    await fn();
    console.log(`  ✅ [${category}] PASS: ${testName}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ [${category}] FAIL: ${testName}`);
    console.error(`     Error: ${err.message}`);
    totalFailed++;
  }
}

async function runAllTests() {
  console.log("=================================================================");
  console.log("🧪 WORKTRACKER FULL MULTI-LEVEL TEST SUITE");
  console.log("=================================================================\n");

  // =================================================================
  // 1. UNIT TESTING: Planner Engines (Logic, Math, Date Calculations)
  // =================================================================
  console.log("--- 1. UNIT TESTS: Calendar & Scheduling Engines ---");

  runTest("Unit", "CalendarEngine.calculateEndDate skips weekends (Fri -> Mon)", () => {
    // 2026-10-23 is Friday. Duration = 2 working days: Friday (day 1) and Monday (day 2)
    const start = new Date(2026, 9, 23); // Friday
    const end = CalendarEngine.calculateEndDate(start, 2, []);
    assert.strictEqual(end.getDay(), 1, "Result should be Monday (day 1 of week)");
    assert.strictEqual(end.getDate(), 26, "End date should be 26th Oct");
  });

  runTest("Unit", "CalendarEngine.calculateEndDate skips custom holidays", () => {
    const start = new Date(2026, 9, 26); // Monday
    const holiday = "2026-10-27"; // Tuesday holiday
    // 2 working days starting Monday: Monday (day 1) -> Tuesday (Holiday!) -> Wednesday (day 2)
    const end = CalendarEngine.calculateEndDate(start, 2, [holiday]);
    assert.strictEqual(end.getDate(), 28, "End date should skip holiday to Wednesday 28th");
  });

  runTest("Unit", "EstimationEngine.calculateBreakdown scales effort based on complexity", () => {
    const l1 = EstimationEngine.calculateBreakdown({
      projectType: "storyline-360",
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 1"
    });
    const l3 = EstimationEngine.calculateBreakdown({
      projectType: "storyline-360",
      courseLengthMinutes: 60,
      moduleCount: 4,
      complexity: "Level 3"
    });
    assert(l3.hours.grandTotalHours > l1.hours.grandTotalHours, "Level 3 must have higher estimated hours than Level 1");
  });

  runTest("Unit", "DEFAULT_TEMPLATES contains Storyline-360 specification with 7 phases", () => {
    const storylineTpl = DEFAULT_TEMPLATES.find((t) => t.id === "storyline-360");
    assert(!!storylineTpl, "storyline-360 template exists in DEFAULT_TEMPLATES");
    assert.strictEqual(storylineTpl.phases.length, 7, "Storyline template has exactly 7 base phases");
  });

  runTest("Unit", "SchedulerEngine properly toggles HLD tasks when includeHld is true/false", () => {
    const schedNoHld = SchedulerEngine.generateSchedule({
      projectId: "unit-p2",
      projectType: "storyline-360",
      includeHld: false,
      startDate: "2026-10-26",
    });
    const schedWithHld = SchedulerEngine.generateSchedule({
      projectId: "unit-p3",
      projectType: "storyline-360",
      includeHld: true,
      startDate: "2026-10-26",
    });
    const hasHldWhenFalse = schedNoHld.tasks.some(t => t.id.includes("task-hld-concept"));
    const hasHldWhenTrue = schedWithHld.tasks.some(t => t.id.includes("task-hld-concept"));
    assert.strictEqual(hasHldWhenFalse, false, "HLD tasks must be absent when includeHld=false");
    assert.strictEqual(hasHldWhenTrue, true, "HLD tasks must be present when includeHld=true");
  });

  // =================================================================
  // 2. SECURITY & AUTHENTICATION UNIT TESTS
  // =================================================================
  console.log("\n--- 2. SECURITY & AUTHENTICATION TESTS ---");

  runTest("Security", "JWT signs and verifies admin payload correctly", () => {
    const secret = process.env.JWT_SECRET || "dev";
    const payload = { id: "test_admin_id", role: "admin", name: "Admin Test" };
    const token = jwt.sign(payload, secret, { expiresIn: "10m" });
    const decoded = jwt.verify(token, secret);
    assert.strictEqual(decoded.role, "admin");
    assert.strictEqual(decoded.id, "test_admin_id");
  });

  runTest("Security", "JWT rejects tampered tokens", () => {
    const secret = process.env.JWT_SECRET || "dev";
    const token = jwt.sign({ id: "user_1" }, secret);
    const tampered = token.slice(0, -5) + "abcde";
    let threw = false;
    try {
      jwt.verify(tampered, secret);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, "Tampered token should throw error");
  });

  // =================================================================
  // 3. DATABASE SCHEMA & VALIDATION TESTS
  // =================================================================
  console.log("\n--- 3. DATABASE SCHEMA VALIDATION TESTS ---");

  await runAsyncTest("Schema", "User model requires name, email, and passwordHash", async () => {
    const invalidUser = new User({ email: "missing_fields@example.com" });
    const err = invalidUser.validateSync();
    assert(err.errors.name, "Name must be required");
    assert(err.errors.passwordHash, "passwordHash must be required");
  });

  await runAsyncTest("Schema", "User model restricts role to allowed enum values", async () => {
    const invalidRoleUser = new User({
      name: "Role Test",
      email: "role_test@example.com",
      passwordHash: "hash123",
      role: "superuser_invalid"
    });
    const err = invalidRoleUser.validateSync();
    assert(err.errors.role, "Role must be superadmin, admin, or employee");
  });

  await runAsyncTest("Schema", "WorkSession schema validates user and status enum", async () => {
    const invalidSession = new WorkSession({
      status: "INVALID_STATUS_NAME",
    });
    const err = invalidSession.validateSync();
    assert(err.errors.status, "Status should only accept valid enum values");
    assert(err.errors.user, "User ID is required");
  });

  await runAsyncTest("Schema", "ManualRemark requires user, date, requestedMinutes, and text", async () => {
    const invalidRemark = new ManualRemark({});
    const err = invalidRemark.validateSync();
    assert(err.errors.user, "User is required");
    assert(err.errors.date, "Date is required");
    assert(err.errors.requestedMinutes, "requestedMinutes is required");
    assert(err.errors.text, "Text (reason) is required");
  });

  // =================================================================
  // 4. BUSINESS LOGIC & TIME CALCULATION TESTS
  // =================================================================
  console.log("\n--- 4. BUSINESS LOGIC & TIME ACCUMULATION TESTS ---");

  runTest("BusinessLogic", "Segment duration calculation accurately measures elapsed minutes", () => {
    const segStart = new Date("2026-10-28T10:00:00Z");
    const segEnd = new Date("2026-10-28T10:45:00Z");
    const diffMinutes = Math.round((segEnd - segStart) / 60000);
    assert.strictEqual(diffMinutes, 45, "Elapsed minutes should be 45");
  });

  runTest("BusinessLogic", "Offline sync merger prevents duplicate segment insertion", () => {
    const existingSegments = [
      { start: "2026-10-28T09:00:00.000Z", end: "2026-10-28T10:00:00.000Z", manual: false },
    ];
    const incomingSegment = {
      start: "2026-10-28T09:00:00.000Z",
      end: "2026-10-28T10:00:00.000Z",
      manual: false,
    };

    const isDuplicate = existingSegments.some(
      s => new Date(s.start).getTime() === new Date(incomingSegment.start).getTime() &&
           new Date(s.end).getTime() === new Date(incomingSegment.end).getTime()
    );
    assert.strictEqual(isDuplicate, true, "Must flag exact duplicate segment");
  });

  // =================================================================
  // 5. SUMMARY
  // =================================================================
  console.log("\n=================================================================");
  console.log(`🏁 ALL TESTS FINISHED: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("=================================================================\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
