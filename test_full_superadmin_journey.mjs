// backend/test_full_superadmin_journey.mjs
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
import Company from "./models/Company.js";
import Category from "./models/Category.js";
import Project from "./models/Project.js";
import User from "./models/User.js";
import ManualRemark from "./models/ManualRemark.js";

dotenv.config();

const PORT = 3095;
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "dev";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function ymd(d = new Date()) {
  const istDate = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
}

async function runFullSuperAdminJourney() {
  console.log("=========================================================================");
  console.log("🌟 WORKTRACKER END-TO-END SUPER ADMIN GOVERNANCE & SECURITY JOURNEY");
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

  // Cleanup references
  let superAdminUser = null;
  let testRegularAdminUser = null;
  let testTargetAdminUser = null;
  let testEmployeeUser = null;
  let testCompanyId = null;
  let testCategoryId = null;
  let testProjectId = null;
  let testRemarkId = null;

  function assertStep(condition, message) {
    if (condition) {
      console.log(`  ✅ STEP ${stepNumber}: PASS - ${message}`);
      passedSteps++;
    } else {
      console.error(`  ❌ STEP ${stepNumber}: FAIL - ${message}`);
      throw new Error(`Super Admin Journey aborted at step ${stepNumber}: ${message}`);
    }
    stepNumber++;
  }

  try {
    const uniqueTag = Date.now().toString().slice(-5);

    // -------------------------------------------------------------
    // PHASE 1: Super Admin Authentication & Privilege Setup
    // -------------------------------------------------------------
    console.log("--- PHASE 1: Super Admin Authentication & Profile Access ---");

    // Ensure dedicated test Super Admin exists
    const superEmail = `superadmin_audit_${uniqueTag}@enterprise.com`;
    superAdminUser = await User.create({
      name: "Victoria Vance (Super Admin Executive)",
      email: superEmail,
      passwordHash: "dummy_super_hash",
      role: "superadmin",
      status: "active",
      designation: "Manager",
      personalDetails: {
        panNumber: "ABCDE1234F",
        nationalId: "9876-5432-1098",
        bankDetails: { accountNumber: "998877665544", ifscCode: "HDFC0001234", bankName: "HDFC Bank" },
        salaryDetails: { ctcAnnual: 3600000, monthlyBasic: 150000 },
      },
    });

    // Also create a regular admin to test security boundaries
    const regularAdminEmail = `regular_admin_${uniqueTag}@enterprise.com`;
    testRegularAdminUser = await User.create({
      name: "Marcus Cole (Standard Admin)",
      email: regularAdminEmail,
      passwordHash: "dummy_admin_hash",
      role: "admin",
      status: "active",
      designation: "Manager",
    });

    const superAdminToken = jwt.sign(
      { id: superAdminUser._id, role: "superadmin", name: superAdminUser.name },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    const regularAdminToken = jwt.sign(
      { id: testRegularAdminUser._id, role: "admin", name: testRegularAdminUser.name },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    assertStep(!!superAdminToken, `Super Admin "${superAdminUser.name}" authenticated with highest role: superadmin`);
    assertStep(!!regularAdminToken, `Regular Admin "${testRegularAdminUser.name}" authenticated with standard admin role`);

    // -------------------------------------------------------------
    // PHASE 2: Confidential Personal & Banking Data Isolation
    // -------------------------------------------------------------
    console.log("\n--- PHASE 2: Confidential Personal & Banking Data Isolation ---");

    // Regular admin views users: personalDetails must be stripped or empty
    const adminViewUsersRes = await fetch(`${BASE}/api/users`, {
      headers: { Authorization: `Bearer ${regularAdminToken}` },
    });
    const adminViewUsers = await adminViewUsersRes.json();
    const superRecordInAdminView = adminViewUsers.find((u) => String(u._id || u.id) === String(superAdminUser._id));
    assertStep(
      !superRecordInAdminView?.personalDetails?.bankDetails?.accountNumber,
      "Regular Admin cannot view sensitive banking or salary details (data stripped)"
    );

    // Super admin views users: full personalDetails must be unmasked
    const superViewUsersRes = await fetch(`${BASE}/api/users`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const superViewUsers = await superViewUsersRes.json();
    const superRecordInSuperView = superViewUsers.find((u) => String(u._id || u.id) === String(superAdminUser._id));
    assertStep(
      superRecordInSuperView?.personalDetails?.bankDetails?.accountNumber === "998877665544",
      "Super Admin successfully accesses unmasked confidential banking & salary details"
    );

    // -------------------------------------------------------------
    // PHASE 3: Role Boundary Enforcement & Admin Governance
    // -------------------------------------------------------------
    console.log("\n--- PHASE 3: Role Boundary Enforcement & Admin Creation ---");

    // 1. Regular admin tries to create a Super Admin account -> MUST BE BLOCKED (403)
    const rogueCreateRes = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularAdminToken}`,
      },
      body: JSON.stringify({
        name: "Rogue Super Admin",
        email: `rogue_super_${uniqueTag}@testcorp.com`,
        password: "Pass123!Password",
        role: "superadmin",
      }),
    });
    assertStep(rogueCreateRes.status === 403, "Regular Admin blocked from creating Super Admin accounts (403 Forbidden)");

    // 2. Super Admin provisions a Target Admin with personal details
    const targetAdminEmail = `target_admin_${uniqueTag}@testcorp.com`;
    const superCreateAdminRes = await fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        name: "Edward Norton (Audited Administrator)",
        email: targetAdminEmail,
        password: "Password123!Secure",
        role: "admin",
        designation: "Manager",
        personalDetails: {
          phone: "+91 9876543210",
          panNumber: "PQRST5678G",
        },
      }),
    });
    const targetAdminData = await superCreateAdminRes.json();
    assertStep(
      superCreateAdminRes.status === 201 && (targetAdminData._id || targetAdminData.id),
      `Super Admin successfully provisioned Administrator account: "${targetAdminData.name}"`
    );
    testTargetAdminUser = targetAdminData;

    // -------------------------------------------------------------
    // PHASE 4: Promotion & Super Admin Account Protection
    // -------------------------------------------------------------
    console.log("\n--- PHASE 4: Promotion Guard & Super Admin Profile Protection ---");

    // Create a regular employee for promotion test
    testEmployeeUser = await User.create({
      name: "Hannah Wells (Senior Developer)",
      email: `hannah_emp_${uniqueTag}@testcorp.com`,
      passwordHash: "dummy_emp_hash",
      role: "employee",
      status: "active",
      designation: "Storyline Developer",
    });

    // Regular admin tries to promote Hannah to superadmin -> MUST BE BLOCKED (403)
    const roguePromoteRes = await fetch(`${BASE}/api/users/${testEmployeeUser._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularAdminToken}`,
      },
      body: JSON.stringify({ role: "superadmin" }),
    });
    assertStep(roguePromoteRes.status === 403, "Regular Admin blocked from promoting users to Super Admin (403 Forbidden)");

    // Regular admin tries to modify the Super Admin profile -> MUST BE BLOCKED (403)
    const rogueEditSuperRes = await fetch(`${BASE}/api/users/${superAdminUser._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularAdminToken}`,
      },
      body: JSON.stringify({ name: "Hacked Super Admin Name" }),
    });
    assertStep(rogueEditSuperRes.status === 403, "Regular Admin blocked from modifying Super Admin profiles (403 Forbidden)");

    // Super Admin updates employee role to admin
    const superPromoteRes = await fetch(`${BASE}/api/users/${testEmployeeUser._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ role: "admin", designation: "Manager" }),
    });
    assertStep(superPromoteRes.status === 200, "Super Admin successfully promoted employee to Administrator role");

    // -------------------------------------------------------------
    // PHASE 5: Deletion Safeguards & Admin Governance
    // -------------------------------------------------------------
    console.log("\n--- PHASE 5: Administrative Deletion Controls & Immunity ---");

    const targetAdminId = testTargetAdminUser._id || testTargetAdminUser.id;

    // Regular admin tries to delete another Admin -> MUST BE BLOCKED (403)
    const rogueDeleteAdminRes = await fetch(`${BASE}/api/users/${targetAdminId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${regularAdminToken}` },
    });
    assertStep(rogueDeleteAdminRes.status === 403, "Regular Admin blocked from deleting other Administrators (403 Forbidden)");

    // Super admin account deletion attempt -> MUST ALWAYS BE BLOCKED (403)
    const deleteSuperRes = await fetch(`${BASE}/api/users/${superAdminUser._id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assertStep(deleteSuperRes.status === 403, "Super Admin accounts have permanent deletion protection (cannot be deleted)");

    // Super Admin successfully deletes the target Admin
    const superDeleteAdminRes = await fetch(`${BASE}/api/users/${targetAdminId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assertStep(superDeleteAdminRes.status === 200, "Super Admin successfully deleted target Administrator account");
    testTargetAdminUser = null; // Already deleted

    // -------------------------------------------------------------
    // PHASE 6: Executive Operations & Global Supervision
    // -------------------------------------------------------------
    console.log("\n--- PHASE 6: Executive Operations & Global Oversight ---");

    // Super Admin creates high-level organization master (Company & Category)
    const compRes = await fetch(`${BASE}/api/companies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ name: `Apex Defense Technologies ${uniqueTag}` }),
    });
    const compData = await compRes.json();
    testCompanyId = compData._id;
    assertStep(compRes.status === 201 && !!testCompanyId, `Super Admin provisioned Strategic Client Company: "${compData.name}"`);

    const catRes = await fetch(`${BASE}/api/categories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({ name: `Mission Simulations ${uniqueTag}` }),
    });
    const catData = await catRes.json();
    testCategoryId = catData._id;
    assertStep(catRes.status === 201 && !!testCategoryId, `Super Admin provisioned Domain Category: "${catData.name}"`);

    // Super Admin provisions priority project
    const projRes = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        name: `Executive Mission Simulation ${uniqueTag}`,
        code: `APX-${uniqueTag}`,
        company: testCompanyId,
        category: testCategoryId,
        status: "active",
      }),
    });
    const projData = await projRes.json();
    testProjectId = projData._id;
    assertStep(projRes.status === 201 && !!testProjectId, `Super Admin established High-Priority Project: "${projData.name}"`);

    // Super Admin approves pending manual remark
    const todayStr = ymd(new Date());
    const pendingRemark = await ManualRemark.create({
      user: testEmployeeUser._id,
      project: testProjectId,
      date: todayStr,
      requestedMinutes: 120,
      text: "Executive Architecture Strategy & Client Alignment",
      taskType: "Analysis",
      status: "pending",
    });
    testRemarkId = pendingRemark._id;

    const approveRes = await fetch(`${BASE}/api/manual-remarks/${testRemarkId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({}),
    });
    assertStep(approveRes.status === 200, "Super Admin approved 120-minute executive session adjustment");

    // Super Admin queries global organization reports
    const reportRes = await fetch(`${BASE}/api/reports/summary?from=${todayStr}&to=${todayStr}`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    const reportData = await reportRes.json();
    assertStep(reportRes.status === 200 && Array.isArray(reportData), "Super Admin reviewed enterprise cross-divisional summary report");

    console.log("\n=========================================================================");
    console.log(`🎉 FULL SUPER ADMIN JOURNEY SUCCESSFUL: ALL ${passedSteps} STEPS PASSED WITHOUT ERROR`);
    console.log("=========================================================================\n");

  } finally {
    // -------------------------------------------------------------
    // PHASE 7: Teardown & Clean-up
    // -------------------------------------------------------------
    console.log("--- CLEANUP: Removing Super Admin Test Artifacts ---");
    if (testRemarkId) {
      await ManualRemark.findByIdAndDelete(testRemarkId);
      console.log(`  ✓ Removed test manual remark (${testRemarkId})`);
    }
    if (testProjectId) {
      await Project.findByIdAndDelete(testProjectId);
      console.log(`  ✓ Removed test project (${testProjectId})`);
    }
    if (testCompanyId) {
      await Company.findByIdAndDelete(testCompanyId);
      console.log(`  ✓ Removed test company (${testCompanyId})`);
    }
    if (testCategoryId) {
      await Category.findByIdAndDelete(testCategoryId);
      console.log(`  ✓ Removed test category (${testCategoryId})`);
    }
    if (testTargetAdminUser?._id || testTargetAdminUser?.id) {
      await User.findByIdAndDelete(testTargetAdminUser._id || testTargetAdminUser.id);
    }
    if (testEmployeeUser?._id) {
      await User.findByIdAndDelete(testEmployeeUser._id);
      console.log(`  ✓ Removed test employee (${testEmployeeUser._id})`);
    }
    if (testRegularAdminUser?._id) {
      await User.findByIdAndDelete(testRegularAdminUser._id);
      console.log(`  ✓ Removed test regular admin (${testRegularAdminUser._id})`);
    }
    if (superAdminUser?._id) {
      await User.findByIdAndDelete(superAdminUser._id);
      console.log(`  ✓ Removed test super admin (${superAdminUser._id})`);
    }

    server.close();
    await mongoose.disconnect();
    console.log("  ✓ Closed test server and database connection.\n");
  }
}

runFullSuperAdminJourney().catch((err) => {
  console.error("\n💥 Super Admin Journey test failed with error:", err.message);
  process.exit(1);
});
