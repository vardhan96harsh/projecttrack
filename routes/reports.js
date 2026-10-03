// backend/routes/reports.js
import express from "express";
import mongoose from "mongoose";
import WorkSession from "../models/WorkSession.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Strict 24-character hexadecimal ObjectId check to prevent 12-char string false positives
const isHexObjectId = (v) => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

function parseDateRange(from, to) {
  const range = {};
  if (from) range.$gte = String(from).slice(0, 10);
  if (to) range.$lte = String(to).slice(0, 10);
  return range;
}

/**
 * Calculates session hours safely.
 * Caps runaway active time for abandoned/stale sessions (max 14 hours continuous)
 * to avoid reporting skewed multi-hundred hour anomalies.
 */
function calculateSessionHours(s) {
  let minutes = Number(s.accumulatedMinutes) || 0;
  if (s.status === "active" && s.currentStart) {
    const elapsedMs = Date.now() - new Date(s.currentStart).getTime();
    if (elapsedMs > 0) {
      const activeMinutes = elapsedMs / 60000;
      // Cap at 14 hours (840 minutes) max continuous shift per active session
      minutes += Math.min(activeMinutes, 840);
    }
  }
  return Math.max(0, minutes) / 60;
}

/**
 * RFC 4180 compliant CSV field escaping with formula injection mitigation.
 */
function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Mitigate CSV Formula Injection in spreadsheet software
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  // Replace internal newlines with space to prevent broken CSV rows
  str = str.replace(/\r\n|\n|\r/g, " ");
  // Escape double quotes by doubling them per RFC 4180
  return `"${str.replace(/"/g, '""')}"`;
}

// ─────────────────────────────────────────────
// GET /api/reports/summary
// Summary aggregation by dim: "project" | "company" | "category" | "user"
// Supports optional filters: user, project, company, category, taskType
// ─────────────────────────────────────────────
router.get("/summary", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { dim = "project", from, to, user, project, company, category, taskType } = req.query;

    const match = {};
    if (from || to) {
      match.date = parseDateRange(from, to);
    }

    if (user) {
      if (isHexObjectId(user)) {
        match.user = new mongoose.Types.ObjectId(user);
      } else {
        const u = await User.findOne({ $or: [{ name: user }, { email: user }] }).select("_id").lean();
        if (u) match.user = u._id;
      }
    }

    if (project && isHexObjectId(project)) {
      match.project = new mongoose.Types.ObjectId(project);
    }

    if (company || category) {
      const projFilter = {};
      if (company && isHexObjectId(company)) projFilter.company = company;
      if (category && isHexObjectId(category)) projFilter.category = category;
      const matched = await Project.find(projFilter).select("_id").lean();
      const projIds = matched.map((p) => p._id);
      match.project = match.project
        ? { $in: [match.project].filter((id) => projIds.some((p) => p.equals(id))) }
        : { $in: projIds };
    }

    if (taskType) {
      match.taskType = taskType;
    }

    const sessions = await WorkSession.find(match)
      .populate({
        path: "project",
        select: "name company category",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .populate("user", "name email")
      .lean();

    const groups = new Map();

    for (const s of sessions) {
      const hours = calculateSessionHours(s);

      let key = "";
      let label = "";
      let email = null;

      if (dim === "user") {
        key = s.user?._id?.toString() || (typeof s.user === "string" ? s.user : "unknown");
        label = s.user?.name || "Unknown User";
        email = s.user?.email || null;
      } else if (dim === "company") {
        key = s.project?.company?._id?.toString() || "general";
        label = s.project?.company?.name || "General / Internal";
      } else if (dim === "category") {
        key = s.project?.category?._id?.toString() || "general";
        label = s.project?.category?.name || "General / Internal";
      } else {
        // default: "project"
        key = s.project?._id?.toString() || (s.customTask ? `custom_${s.customTask}` : "general");
        label = s.project?.name || (s.customTask ? `(Custom) ${s.customTask}` : "General Project");
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          email,
          totalHours: 0,
          entries: 0,
        });
      }

      const g = groups.get(key);
      g.totalHours += hours;
      g.entries += 1;
    }

    const sorted = Array.from(groups.values())
      .sort((a, b) => b.totalHours - a.totalHours)
      .map((r) => ({
        key: r.key,
        label: r.label,
        email: r.email,
        totalHours: round2(r.totalHours),
        entries: r.entries,
      }));

    res.json(sorted);
  } catch (err) {
    console.error("REPORTS SUMMARY ERROR:", err);
    res.status(500).json({ isOk: false, message: err?.message || "Summary failed" });
  }
});

// ─────────────────────────────────────────────
// GET /api/reports/user-breakdown?user=<userId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Project-level breakdown for a specific user
// ─────────────────────────────────────────────
router.get("/user-breakdown", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { user, from, to } = req.query;
    if (!user) return res.status(400).json({ error: "user is required" });

    const match = {};
    if (user === "unknown") {
      match.$or = [{ user: null }, { user: { $exists: false } }];
    } else if (isHexObjectId(user)) {
      match.user = new mongoose.Types.ObjectId(user);
    } else {
      const u = await User.findOne({ $or: [{ name: user }, { email: user }] }).select("_id").lean();
      if (!u) return res.status(400).json({ error: `User not found: ${user}` });
      match.user = u._id;
    }

    if (from || to) {
      match.date = parseDateRange(from, to);
    }

    const sessions = await WorkSession.find(match)
      .populate({
        path: "project",
        select: "name company category",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .lean();

    const groups = new Map();

    for (const s of sessions) {
      const hours = calculateSessionHours(s);
      const key = s.project?._id?.toString() || (s.customTask ? `custom_${s.customTask}` : "general");
      const projectName = s.project?.name || (s.customTask ? `(Custom) ${s.customTask}` : "General Project");
      const companyName = s.project?.company?.name || "—";
      const categoryName = s.project?.category?.name || "—";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          projectName,
          companyName,
          categoryName,
          totalHours: 0,
          entries: 0,
        });
      }

      const g = groups.get(key);
      g.totalHours += hours;
      g.entries += 1;
    }

    const rows = Array.from(groups.values())
      .sort((a, b) => b.totalHours - a.totalHours)
      .map((r) => ({
        key: r.key,
        projectName: r.projectName,
        companyName: r.companyName,
        categoryName: r.categoryName,
        totalHours: round2(r.totalHours),
        entries: r.entries,
      }));

    res.json(rows);
  } catch (err) {
    console.error("USER BREAKDOWN ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to load user breakdown" });
  }
});

// ─────────────────────────────────────────────
// GET /api/reports/export
// CSV export for filtered work session reports
// ─────────────────────────────────────────────
router.get("/export", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { company, category, project, user, from, to, taskType } = req.query;

    const q = {};
    if (user) {
      if (user === "unknown") {
        q.$or = [{ user: null }, { user: { $exists: false } }];
      } else if (isHexObjectId(user)) {
        q.user = new mongoose.Types.ObjectId(user);
      } else {
        const u = await User.findOne({ $or: [{ name: user }, { email: user }] }).select("_id").lean();
        if (u) q.user = u._id;
      }
    }

    if (project && isHexObjectId(project)) {
      q.project = new mongoose.Types.ObjectId(project);
    }

    if (company || category) {
      const projFilter = {};
      if (company && isHexObjectId(company)) projFilter.company = company;
      if (category && isHexObjectId(category)) projFilter.category = category;
      const matched = await Project.find(projFilter).select("_id").lean();
      const projIds = matched.map((p) => p._id);
      q.project = q.project
        ? { $in: [q.project].filter((id) => projIds.some((p) => p.equals(id))) }
        : { $in: projIds };
    }

    if (taskType) {
      q.taskType = taskType;
    }

    if (from || to) {
      q.date = parseDateRange(from, to);
    }

    const items = await WorkSession.find(q)
      .populate("user", "name email")
      .populate({
        path: "project",
        select: "name company category",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const header = [
      "Date",
      "Employee",
      "Company",
      "Category",
      "Project",
      "Task Type",
      "Hours",
      "Remarks",
    ];
    const lines = [header.map(escapeCsvField).join(",")];

    for (const s of items) {
      const hours = round2(calculateSessionHours(s));
      const row = [
        s.date || "",
        s.user?.name || "Unknown",
        s.project?.company?.name || "—",
        s.project?.category?.name || "—",
        s.project?.name || s.customTask || "—",
        s.taskType || "",
        String(hours),
        s.remarks || "",
      ]
        .map(escapeCsvField)
        .join(",");

      lines.push(row);
    }

    // Prepend UTF-8 BOM (\uFEFF) so Excel on Windows opens international characters cleanly
    const csv = "\uFEFF" + lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=work_sessions_report.csv");
    res.send(csv);
  } catch (err) {
    console.error("REPORTS EXPORT ERROR:", err);
    res.status(500).json({ error: "Failed to export report" });
  }
});

export default router;
