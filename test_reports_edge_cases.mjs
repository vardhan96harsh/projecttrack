// Node native fetch used

const BASE = "http://localhost:3001";

async function testReports() {
  console.log("Testing Reports Edge Cases...");

  // Admin login
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.com", password: "Pass@123" }),
  });
  const { token } = await loginRes.json();
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Nonexistent user should return 0 rows in summary and export, NOT all users
  const badUserSummary = await fetch(`${BASE}/api/reports/summary?user=NoSuchUserEver_99999`, { headers });
  const badUserData = await badUserSummary.json();
  console.log("1. Nonexistent user summary rows:", badUserData.length);
  if (badUserData.length !== 0) throw new Error("Expected 0 rows for nonexistent user in summary!");

  const badUserExport = await fetch(`${BASE}/api/reports/export?user=NoSuchUserEver_99999`, { headers });
  const badUserCsv = await badUserExport.text();
  const badUserCsvRows = badUserCsv.trim().split(/\r?\n/);
  console.log("2. Nonexistent user export lines:", badUserCsvRows.length);
  if (badUserCsvRows.length !== 1) throw new Error("Expected only header row for nonexistent user in export!");

  // 3. User = "unknown" should be handled cleanly
  const unknownSummary = await fetch(`${BASE}/api/reports/summary?user=unknown`, { headers });
  console.log("3. User 'unknown' summary status:", unknownSummary.status);
  if (unknownSummary.status !== 200) throw new Error("Expected 200 for user=unknown in summary!");

  const unknownExport = await fetch(`${BASE}/api/reports/export?user=unknown`, { headers });
  console.log("4. User 'unknown' export status:", unknownExport.status);
  if (unknownExport.status !== 200) throw new Error("Expected 200 for user=unknown in export!");

  // 5. undefined string in date params should not break queries
  const undefinedDateSummary = await fetch(`${BASE}/api/reports/summary?from=undefined&to=undefined`, { headers });
  const undefData = await undefinedDateSummary.json();
  console.log("5. from=undefined&to=undefined summary status:", undefinedDateSummary.status, "rows:", undefData.length);
  if (undefinedDateSummary.status !== 200) throw new Error("Expected 200 for undefined date params!");

  // 6. Project = "general" / "null" should match cleanly
  const generalProjectSummary = await fetch(`${BASE}/api/reports/summary?project=general`, { headers });
  console.log("6. Project 'general' status:", generalProjectSummary.status);
  if (generalProjectSummary.status !== 200) throw new Error("Expected 200 for project=general!");

  // 7. Company by name lookup should not throw or match all projects
  const fakeCompanyExport = await fetch(`${BASE}/api/reports/export?company=NonExistentCompanyABC`, { headers });
  const fakeCompanyCsv = await fakeCompanyExport.text();
  const fakeCompanyLines = fakeCompanyCsv.trim().split(/\r?\n/);
  console.log("7. Nonexistent company export lines:", fakeCompanyLines.length);
  if (fakeCompanyLines.length !== 1) throw new Error("Expected only header row for nonexistent company!");

  // 8. WorkSession admin/list with user=unknown
  const adminListUnknown = await fetch(`${BASE}/api/work-sessions/admin/list?user=unknown`, { headers });
  console.log("8. WorkSessions admin/list user=unknown status:", adminListUnknown.status);
  if (adminListUnknown.status !== 200) throw new Error("Expected 200 for admin/list user=unknown!");

  console.log("✅ ALL REPORTS EDGE CASES PASSED WITH 100% SUCCESS!");
}

testReports().catch((err) => {
  console.error("❌ FAILED:", err);
  process.exit(1);
});
