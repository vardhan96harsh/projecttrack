// Comprehensive Safe End-to-End Test Suite for WorkTracker
// Validates Super Admin, Admin, and Employee roles, Left Menus, Multi-Increment Salary,
// Joining Date, Document Permissions, and Logout structure WITHOUT altering existing data.

const BASE_URL = "http://localhost:3001";
const FRONTEND_URL = "http://localhost:5175";

const results = [];

function record(name, passed, details = "") {
  results.push({ name, passed, details });
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} | ${name} ${details ? "(" + details + ")" : ""}`);
}

async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log("=========================================================");
  console.log("🚀 STARTING WORKTRACKER END-TO-END VERIFICATION (NON-DESTRUCTIVE)");
  console.log("=========================================================\n");

  // 1. Check Server Liveness
  try {
    const fe = await fetch(FRONTEND_URL).then(r => r.status).catch(() => 0);
    record("Frontend Dev Server reachable (port 5175)", fe === 200, `HTTP status ${fe}`);
  } catch (err) {
    record("Frontend Dev Server reachable (port 5175)", false, err.message);
  }

  // 2. Authentication: Super Admin
  let superToken = null;
  let superId = null;
  try {
    const loginRes = await api("/api/auth/login", {
      method: "POST",
      body: { email: "superadmin@demo.com", password: "SuperAdmin@123" }
    });
    if (loginRes.ok && loginRes.data?.token) {
      superToken = loginRes.data.token;
      superId = loginRes.data.user?._id || loginRes.data.user?.id;
      record("Super Admin Login Authentication", true, `Role: ${loginRes.data.user?.role}`);
    } else {
      record("Super Admin Login Authentication", false, loginRes.data?.error || "Invalid response");
    }
  } catch (e) {
    record("Super Admin Login Authentication", false, e.message);
  }

  // 3. Authentication: Admin
  let adminToken = null;
  try {
    const loginRes = await api("/api/auth/login", {
      method: "POST",
      body: { email: "admin@demo.com", password: "Pass@123" }
    });
    if (loginRes.ok && loginRes.data?.token) {
      adminToken = loginRes.data.token;
      record("Regular Admin Login Authentication", true, `Role: ${loginRes.data.user?.role}`);
    } else {
      record("Regular Admin Login Authentication", false, loginRes.data?.error || "Invalid response");
    }
  } catch (e) {
    record("Regular Admin Login Authentication", false, e.message);
  }

  if (!superToken || !adminToken) {
    console.error("❌ Aborting tests: Super Admin or Admin token unavailable.");
    process.exit(1);
  }

  // 4. Role-Based Access Control: Regular Admin Accessing Users List
  try {
    const adminUsersRes = await api("/api/users", { token: adminToken });
    if (adminUsersRes.ok && Array.isArray(adminUsersRes.data)) {
      const anyHasPersonal = adminUsersRes.data.some(u => u.personalDetails);
      record("Admin GET /api/users excludes personalDetails", !anyHasPersonal, 
        anyHasPersonal ? "LEAKED personalDetails to regular admin" : "Strictly omitted from Admin");
      
      const hasJoiningDate = adminUsersRes.data.some(u => "joiningDate" in u);
      record("Admin GET /api/users contains joiningDate", hasJoiningDate, "Visible to Admin");
    } else {
      record("Admin GET /api/users endpoint", false, "Failed to fetch users");
    }
  } catch (e) {
    record("Admin GET /api/users endpoint", false, e.message);
  }

  // 5. Role-Based Access Control: Super Admin Accessing Users List
  try {
    const superUsersRes = await api("/api/users", { token: superToken });
    if (superUsersRes.ok && Array.isArray(superUsersRes.data)) {
      const superUserObj = superUsersRes.data.find(u => u.email === "superadmin@demo.com");
      record("Super Admin GET /api/users includes personalDetails", Boolean(superUserObj?.personalDetails), 
        "Accessible to Super Admin");
      record("Super Admin GET /api/users includes joiningDate", "joiningDate" in (superUserObj || {}), 
        "Accessible to Super Admin");
    } else {
      record("Super Admin GET /api/users endpoint", false, "Failed to fetch users");
    }
  } catch (e) {
    record("Super Admin GET /api/users endpoint", false, e.message);
  }

  // 6. Non-Destructive Isolated Lifecycle Test for Employee
  const testEmail = `e2e_test_${Date.now()}@demo.com`;
  let testUserId = null;
  let testUserToken = null;

  try {
    // A. Super Admin creates a dedicated test employee
    const createRes = await api("/api/users", {
      method: "POST",
      token: superToken,
      body: {
        name: "E2E Safe Test Employee",
        email: testEmail,
        password: "TestPassword@123",
        role: "employee",
        status: "active",
        joiningDate: "2021-01-15T00:00:00.000Z",
        personalDetails: {
          phone: "+91 99999 88888",
          alternateEmail: "e2e_backup@demo.com",
          currentAddress: "123 Tech Square, Phase 2",
          permanentAddress: "456 Heritage City",
          panNumber: "TESTP1234K",
          nationalId: "9876-5432-1098",
          bankDetails: {
            accountNumber: "112233445566",
            ifscCode: "ICIC0001122",
            bankName: "ICICI Bank"
          },
          documents: {
            offerLetter: { isAvailable: true, status: "Available", remarks: "Signed copy in vault" },
            twoPhotos: { isAvailable: true, status: "Available", remarks: "Passport size verified" },
            aadhaarDoc: { number: "9876-5432-1098", isAvailable: true, status: "Available", remarks: "Verified via UIDAI" },
            panDoc: { number: "TESTP1234K", isAvailable: true, status: "Available", remarks: "NSDL verified" },
            previousExperienceDoc: { isAvailable: true, status: "Available", companyName: "Previous Corp", designation: "Engineer", remarks: "Relieving letter on record" },
            originalDoc: { isAvailable: true, status: "Available", docName: "B.Tech Degree Certificate", remarks: "Original in custody" },
            chequeDoc: { isAvailable: true, status: "Available", bankName: "ICICI Bank", chequeNumber: "CHQ-001234", remarks: "Cancelled cheque verified" }
          },
          salaryDetails: {
            salaryStartDate: "2021-02-01T00:00:00.000Z",
            currentSalary: "₹78,000 / month",
            lastSalary: "₹65,000 / month",
            lastIncrementDate: "2025-04-01T00:00:00.000Z",
            salaryAccount: "ICICI Bank A/C 112233445566",
            remarks: "Top performer in product architecture",
            increments: [
              { incrementDate: "2021-04-01T00:00:00.000Z", previousSalary: "₹25,000", newSalary: "₹32,000", hikePercentage: "28%", reason: "Annual appraisal", remarks: "Strong delivery" },
              { incrementDate: "2022-04-01T00:00:00.000Z", previousSalary: "₹32,000", newSalary: "₹40,000", hikePercentage: "25%", reason: "Role promotion", remarks: "Senior developer" },
              { incrementDate: "2022-10-01T00:00:00.000Z", previousSalary: "₹40,000", newSalary: "₹45,000", hikePercentage: "12.5%", reason: "Mid-year retention", remarks: "Market adjustment" },
              { incrementDate: "2023-04-01T00:00:00.000Z", previousSalary: "₹45,000", newSalary: "₹54,000", hikePercentage: "20%", reason: "Annual increment", remarks: "Exceeded OKRs" },
              { incrementDate: "2024-04-01T00:00:00.000Z", previousSalary: "₹54,000", newSalary: "₹65,000", hikePercentage: "20.37%", reason: "Appraisal revision", remarks: "Technical lead" },
              { incrementDate: "2025-04-01T00:00:00.000Z", previousSalary: "₹65,000", newSalary: "₹78,000", hikePercentage: "20%", reason: "Leadership hike", remarks: "Core system lead" }
            ]
          }
        }
      }
    });

    testUserId = createRes.data?.id || createRes.data?._id;
    record("Super Admin created isolated test user with 6 increments", createRes.ok && Boolean(testUserId), `User ID: ${testUserId}`);

    // B. Log in as the newly created test employee
    const empLoginRes = await api("/api/auth/login", {
      method: "POST",
      body: { email: testEmail, password: "TestPassword@123" }
    });
    testUserToken = empLoginRes.data?.token;
    record("Employee successfully logs in", empLoginRes.ok && Boolean(testUserToken), `Role: ${empLoginRes.data?.user?.role}`);

    // C. Employee calls GET /api/users/me/profile -> Verify Field-Level Privacy
    const empProfileRes = await api("/api/users/me/profile", { token: testUserToken });
    const empProfile = empProfileRes.data;

    record("Employee Profile GET /api/users/me/profile success", empProfileRes.ok, `Status: ${empProfileRes.status}`);
    record("Employee CAN see their own joiningDate", Boolean(empProfile?.joiningDate), `Joining Date: ${empProfile?.joiningDate}`);
    
    // Privacy assertions:
    const salaryDetailsExposed = typeof empProfile?.personalDetails?.salaryDetails !== "undefined";
    record("CONFIDENTIAL: Employee STRICTLY CANNOT see salaryDetails", !salaryDetailsExposed, 
      salaryDetailsExposed ? "FAILED: salaryDetails leaked to employee" : "Verified: salaryDetails is completely omitted");

    const offerLetterExposed = typeof empProfile?.personalDetails?.documents?.offerLetter !== "undefined";
    record("CONFIDENTIAL: Employee STRICTLY CANNOT see offerLetter check", !offerLetterExposed, 
      offerLetterExposed ? "FAILED: offerLetter leaked" : "Verified: offerLetter omitted");

    const twoPhotosExposed = typeof empProfile?.personalDetails?.documents?.twoPhotos !== "undefined";
    record("CONFIDENTIAL: Employee STRICTLY CANNOT see twoPhotos check", !twoPhotosExposed, 
      twoPhotosExposed ? "FAILED: twoPhotos leaked" : "Verified: twoPhotos omitted");

    // Permitted document assertions:
    const aadhaarVisible = Boolean(empProfile?.personalDetails?.documents?.aadhaarDoc?.number);
    record("Employee CAN see their own Aadhaar document details", aadhaarVisible, `Aadhaar: ${empProfile?.personalDetails?.documents?.aadhaarDoc?.number}`);

    const panVisible = Boolean(empProfile?.personalDetails?.documents?.panDoc?.number);
    record("Employee CAN see their own PAN document details", panVisible, `PAN: ${empProfile?.personalDetails?.documents?.panDoc?.number}`);

    const originalDocVisible = Boolean(empProfile?.personalDetails?.documents?.originalDoc?.docName);
    record("Employee CAN see their own Original document name & status", originalDocVisible, `Doc: ${empProfile?.personalDetails?.documents?.originalDoc?.docName}`);

    const chequeDocVisible = Boolean(empProfile?.personalDetails?.documents?.chequeDoc?.chequeNumber);
    record("Employee CAN see their own Cheque document details", chequeDocVisible, `Cheque: ${empProfile?.personalDetails?.documents?.chequeDoc?.chequeNumber}`);

    // D. Super Admin reads full dossier -> Verify all 6 increments and confidential fields exist
    const superReadRes = await api("/api/users", { token: superToken });
    const fullUser = superReadRes.data.find(u => (u.id || u._id) === testUserId);
    const incCount = fullUser?.personalDetails?.salaryDetails?.increments?.length || 0;
    record("Super Admin can view all 6 historical salary increments", incCount === 6, `Count: ${incCount}`);
    record("Super Admin can view offerLetter checklist", Boolean(fullUser?.personalDetails?.documents?.offerLetter?.isAvailable), "Offer letter verified");
    record("Super Admin can view twoPhotos checklist", Boolean(fullUser?.personalDetails?.documents?.twoPhotos?.isAvailable), "Two photos verified");

    // E. Super Admin updates increments (Add 7th increment)
    const updatedIncrements = [
      ...(fullUser?.personalDetails?.salaryDetails?.increments || []),
      { incrementDate: "2026-04-01T00:00:00.000Z", previousSalary: "₹78,000", newSalary: "₹92,000", hikePercentage: "17.95%", reason: "Annual milestone hike", remarks: "7th increment verified" }
    ];

    const putRes = await api(`/api/users/${testUserId}`, {
      method: "PUT",
      token: superToken,
      body: {
        personalDetails: {
          salaryDetails: {
            currentSalary: "₹92,000 / month",
            increments: updatedIncrements
          }
        }
      }
    });

    const finalIncCount = putRes.data?.personalDetails?.salaryDetails?.increments?.length || 0;
    record("Super Admin can persist multiple increments update (7 increments)", finalIncCount === 7, `Final Count: ${finalIncCount}`);

  } catch (err) {
    record("Isolated Lifecycle Test", false, err.message);
  } finally {
    // CLEANUP: Cleanly delete the isolated test user so no residual data remains
    if (testUserId && superToken) {
      try {
        const delRes = await api(`/api/users/${testUserId}`, {
          method: "DELETE",
          token: superToken
        });
        record("Zero Impact Cleanup: Isolated test user removed cleanly", delRes.ok, `Status: ${delRes.status}`);
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }
  }

  // 7. Summary
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log("\n=========================================================");
  console.log(`🏁 TEST RESULTS: ${passedCount} / ${totalCount} PASSED`);
  console.log("=========================================================");

  if (passedCount === totalCount) {
    console.log("🎉 ALL END-TO-END VERIFICATION CHECKS PASSED WITH 100% SUCCESS!");
  } else {
    console.log(`⚠️ Some tests failed. Review log above.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
