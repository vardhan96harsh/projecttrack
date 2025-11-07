import express from "express";
import mongoose from "mongoose";
import WorkSession from "../models/WorkSession.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const round2 = (n) => Math.round(n * 100) / 100;

function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isValidObjectId(v) { return mongoose.Types.ObjectId.isValid(v); }

/* ---------------------------- EMPLOYEE ACTIONS ----------------------------- */

// POST /api/work-sessions/start
router.post("/start", requireAuth, async (req, res) => {
  const { projectId, remarks = "", machineId, machineInfo } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  const project = await Project.findById(projectId)
    .select("_id name")
    .populate("company category", "name");
  if (!project) return res.status(404).json({ error: "Project not found" });

  const existing = await WorkSession.findOne({ user: req.user._id, status: "active" });
  if (existing) return res.status(400).json({ error: "An active session already exists." });

  const session = await WorkSession.create({
    user: req.user._id,
    project: project._id,
    date: ymd(new Date()),
    status: "active",
    segments: [],
    accumulatedMinutes: 0,
    currentStart: new Date(),
    remarks,
    // persist machine identity if provided by desktop app
    machineId: machineId || undefined,
    machineInfo: machineInfo || undefined,
  });

  res.json({
    ...session.toObject(),
    projectName: project.name,
    totalMinutes: round2(session.accumulatedMinutes || 0),
  });
});

// POST /api/work-sessions/pause
router.post("/pause", requireAuth, async (req, res) => {
  const { machineId, machineInfo } = req.body || {};
  const session = await WorkSession.findOne({ user: req.user._id, status: "active" });
  if (!session) return res.status(404).json({ error: "No active session found." });

  const now = new Date();
  if (!session.currentStart) return res.status(400).json({ error: "No running segment to pause." });

  // close segment
  session.segments.push({ start: session.currentStart, end: now });

  // add exact minutes (float)
  const ms = now - new Date(session.currentStart);
  const minutes = ms > 0 ? (ms / 60000) : 0;
  session.accumulatedMinutes = (session.accumulatedMinutes || 0) + minutes;

  session.currentStart = null;
  session.status = "paused";

  if (machineId) session.machineId = machineId;
  if (machineInfo) session.machineInfo = machineInfo;

  await session.save();
  res.json({ ...session.toObject(), totalMinutes: round2(session.accumulatedMinutes || 0) });
});

// POST /api/work-sessions/resume
router.post("/resume", requireAuth, async (req, res) => {
  const { machineId, machineInfo } = req.body || {};
  const session = await WorkSession.findOne({ user: req.user._id, status: "paused" });
  if (!session) return res.status(404).json({ error: "No paused session found." });

  session.status = "active";
  session.currentStart = new Date();

  if (machineId) session.machineId = machineId;
  if (machineInfo) session.machineInfo = machineInfo;

  await session.save();
  res.json({ ...session.toObject(), totalMinutes: round2(session.accumulatedMinutes || 0) });
});

// POST /api/work-sessions/stop
router.post("/stop", requireAuth, async (req, res) => {
  const { remarks = "", machineId, machineInfo } = req.body || {};
  const session = await WorkSession.findOne({
    user: req.user._id,
    status: { $in: ["active", "paused"] },
  });
  if (!session) return res.status(404).json({ error: "No active/paused session found." });

  const now = new Date();

  // if active, close running segment and add minutes
  if (session.status === "active" && session.currentStart) {
    session.segments.push({ start: session.currentStart, end: now });
    const ms = now - new Date(session.currentStart);
    const minutes = ms > 0 ? (ms / 60000) : 0;
    session.accumulatedMinutes = (session.accumulatedMinutes || 0) + minutes;
    session.currentStart = null;
  }

  session.status = "stopped";
  session.remarks = remarks;

  if (machineId) session.machineId = machineId;
  if (machineInfo) session.machineInfo = machineInfo;

  await session.save();
  res.json({ ...session.toObject(), totalMinutes: round2(session.accumulatedMinutes || 0) });
});

// GET /api/work-sessions/my
router.get("/my", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const q = { user: req.user._id };
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = from;
    if (to) q.date.$lte = to;
  }

  const rows = await WorkSession.find(q)
    .populate({
      path: "project",
      select: "name company category",
      populate: [
        { path: "company", select: "name" },
        { path: "category", select: "name" },
      ],
    })
    .sort({ createdAt: -1 })
    .lean();

  const data = rows.map((s) => {
    let total = s.accumulatedMinutes ?? 0;
    if (s.status === "active" && s.currentStart) {
      total += (Date.now() - new Date(s.currentStart)) / 60000;
    }
    return {
      _id: s._id,
      date: s.date,
      status: s.status,
      projectId: s.project?._id || null,
      projectName: s.project?.name || "(No project)",
      companyName: s.project?.company?.name || "—",
      categoryName: s.project?.category?.name || "—",
      currentStart: s.currentStart || null,
      accumulatedMinutes: s.accumulatedMinutes ?? 0,
      totalMinutes: round2(total),
      remarks: s.remarks || "",
      machineId: s.machineId || null,
      machineInfo: s.machineInfo || null,
      createdAt: s.createdAt,
    };
  });

  res.json(data);
});

/* ----------------------------- ADMIN LIST ---------------------------------- */

router.get("/admin/list", requireAuth, requireRole("admin"), async (req, res) => {
  const { date, from, to, company, category, project, user, machine } = req.query;

  const q = {};
  if (date) q.date = date;
  if (from || to) {
    q.date = q.date || {};
    if (from) q.date.$gte = from;
    if (to) q.date.$lte = to;
  }

  if (user) {
    if (isValidObjectId(user)) q.user = new mongoose.Types.ObjectId(user);
    else {
      const u = await User.findOne({ $or: [{ name: user }, { email: user }] })
        .select("_id").lean();
      if (!u) return res.status(400).json({ error: `No user found for '${user}'` });
      q.user = u._id;
    }
  }

  if (project) {
    if (!isValidObjectId(project)) return res.status(400).json({ error: "project must be a valid ObjectId" });
    q.project = new mongoose.Types.ObjectId(project);
  }

  // ⬇ NEW: filter by machineId if provided
  if (machine) {
    q.machineId = machine;
  }

  const rows = await WorkSession.find(q)
    .populate({
      path: "project",
      select: "name category company",
      populate: [
        { path: "company", select: "name" },
        { path: "category", select: "name" },
      ],
    })
    .populate({ path: "user", select: "name email" })
    .sort({ createdAt: -1 })
    .lean();

  const data = rows.map((s) => {
    let total = s.accumulatedMinutes ?? 0;
    if (s.status === "active" && s.currentStart) {
      total += (Date.now() - new Date(s.currentStart)) / 60000;
    }
    return {
      _id: s._id,
      date: s.date,
      status: s.status,
      totalMinutes: round2(total),
      segments: s.segments || [],
      remarks: s.remarks || "",
      createdAt: s.createdAt,

      userId: s.user?._id || null,
      userName: s.user?.name || "(unknown)",
      userEmail: s.user?.email || "",

      projectId: s.project?._id || null,
      projectName: s.project?.name || "(No project)",
      companyId: s.project?.company?._id || null,
      companyName: s.project?.company?.name || "—",
      categoryId: s.project?.category?._id || null,
      categoryName: s.project?.category?.name || "—",

      // expose machine in admin payload
      machineId: s.machineId || null,
      machineInfo: s.machineInfo || null,
    };
  });

  res.json(data);
});

/* ------------------------------- ADMIN EXPORT (CSV) --------------------------------
   GET /api/work-sessions/export?date=YYYY-MM-DD&from=&to=&company=&category=&project=&user=&machine=
   Requires: requireAuth + requireRole("admin")
------------------------------------------------------------------------------------ */
router.get("/export", requireAuth, requireRole("admin"), async (req, res) => {
  const { date, from, to, company, category, project, user, machine } = req.query;

  // ---- Build base query (same as /admin/list) ----
  const q = {};
  if (date) q.date = date;
  if (from || to) {
    q.date = q.date || {};
    if (from) q.date.$gte = from;
    if (to) q.date.$lte = to;
  }

  // user filter: id OR name/email
  if (user) {
    if (isValidObjectId(user)) {
      q.user = new mongoose.Types.ObjectId(user);
    } else {
      const u = await User.findOne({ $or: [{ name: user }, { email: user }] })
        .select("_id")
        .lean();
      if (!u) {
        return res
          .status(400)
          .json({ error: `No user found for '${user}'. Use _id, name, or email.` });
      }
      q.user = u._id;
    }
  }

  // project filter
  if (project) {
    if (!isValidObjectId(project)) {
      return res.status(400).json({ error: "project must be a valid ObjectId" });
    }
    q.project = new mongoose.Types.ObjectId(project);
  }

  // machine filter
  if (machine) {
    q.machineId = machine;
  }

  // We'll filter by company/category via populate match (same pattern as /admin/list)
  const companyMatch =
    company && isValidObjectId(company)
      ? { _id: new mongoose.Types.ObjectId(company) }
      : company
      ? (await (async () => {
          return res.status(400).json({ error: "company must be a valid ObjectId" });
        })())
      : {};

  const categoryMatch =
    category && isValidObjectId(category)
      ? { _id: new mongoose.Types.ObjectId(category) }
      : category
      ? (await (async () => {
          return res.status(400).json({ error: "category must be a valid ObjectId" });
        })())
      : {};

  // ---- Query sessions + populate ----
  const rows = await WorkSession.find(q)
    .populate({
      path: "project",
      select: "name category company",
      populate: [
        { path: "company", select: "name", match: companyMatch || {} },
        { path: "category", select: "name", match: categoryMatch || {} },
      ],
    })
    .populate({ path: "user", select: "name email" })
    .sort({ createdAt: 1 }) // chronological export
    .lean();

  // Filter-out rows where project failed the populate match
  const filtered = rows.filter((r) => {
    if (company && !r.project?.company) return false;
    if (category && !r.project?.category) return false;
    return true;
  });

  // ---- Shape for CSV ----
  const shaped = filtered.map((s) => {
    let total = s.accumulatedMinutes ?? 0;
    if (s.status === "active" && s.currentStart) {
      total += (Date.now() - new Date(s.currentStart)) / 60000;
    }

    // segments in "hh:mm AM/PM - hh:mm AM/PM" joined with "; "
    const segs = Array.isArray(s.segments) ? s.segments : [];
    const fmt12 = (dt) =>
      dt
        ? new Date(dt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : "";
    const segmentsPretty = segs
      .map((g) => `${fmt12(g.start)} - ${g.end ? fmt12(g.end) : ""}`)
      .join("; ");

    const hostname = s.machineInfo?.hostname || "";
    const machineShort = s.machineId || "";

    return {
      Date: s.date || "",
      User: s.user?.name || "",
      Email: s.user?.email || "",
      Company: s.project?.company?.name || "—",
      Category: s.project?.category?.name || "—",
      Project: s.project?.name || "(No project)",
      Status: s.status,
      TotalMinutes: round2(total),
      SegmentsCount: segs.length,
      Segments: segmentsPretty,
      Remarks: s.remarks || "",
      MachineHost: hostname,
      MachineId: machineShort,
      CreatedAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
      UpdatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
    };
  });

  // ---- Build CSV ----
  const headers = Object.keys(shaped[0] || {
    Date: "",
    User: "",
    Email: "",
    Company: "",
    Category: "",
    Project: "",
    Status: "",
    TotalMinutes: "",
    SegmentsCount: "",
    Segments: "",
    Remarks: "",
    MachineHost: "",
    MachineId: "",
    CreatedAt: "",
    UpdatedAt: "",
  });

  const esc = (val) => {
    if (val == null) return "";
    const s = String(val);
    // Escape quotes by doubling, wrap in quotes if contains comma/quote/newline
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
    };

  const lines = [];
  lines.push(headers.map(esc).join(","));
  for (const row of shaped) {
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }
  const csv = lines.join("\n");

  // ---- Send CSV ----
  const filename = `work-sessions_${(from || date || "all")}_to_${(to || date || "all")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});


export default router;
