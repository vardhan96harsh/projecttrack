import express from "express";
import mongoose from "mongoose";
import WorkSession from "../models/WorkSession.js";
import Project from "../models/Project.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import ManualRemark from "../models/ManualRemark.js";


const router = express.Router();
const round2 = (n) => Math.round(n * 100) / 100;
const WORK_TYPES = ["Alpha", "Beta", "CR", "Rework", "poc"]; // 🔹 work type options


function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isValidObjectId(v) { return mongoose.Types.ObjectId.isValid(v); }

/* ---------------------------- EMPLOYEE ACTIONS ----------------------------- */
// GET /api/work-sessions/work-types
router.get("/work-types", requireAuth, async (req, res) => {
  res.json(WORK_TYPES);
});

// POST /api/work-sessions/start
// POST /api/work-sessions/start
router.post("/start", requireAuth, async (req, res) => {
  const {
    projectId,
     customTask,
    remarks = "",
    machineId,
    machineInfo,
    taskType,
    workType,
  } = req.body || {};

 // allow custom task if no project is selected
if (!projectId && !customTask) {
  return res.status(400).json({
    error: "Either projectId or customTask is required.",
  });
}



  const requestedType = taskType || workType;
  const chosenType = WORK_TYPES.includes(requestedType)
    ? requestedType
    : "Alpha";

  const todayStr = ymd(new Date());

  // 🔹 1) Auto-stop any old active sessions from previous days
  const staleResult = await WorkSession.updateMany(
    {
      user: req.user._id,
      status: "active",
      date: { $ne: todayStr },
    },
    {
      $set: { status: "stopped", currentStart: null },
    }
  );
  console.log("Auto-stopped stale active sessions:", staleResult.modifiedCount);

  // 🔹 2) Now only look for active *today*
  const existing = await WorkSession.findOne({
    user: req.user._id,
    status: "active",
    date: todayStr,
  });

  if (existing) {
    console.log("⛔ /start – active session already exists for today:", existing._id);
    return res
      .status(400)
      .json({ error: "An active session already exists for today." });
  }

 let project = null;

if (projectId) {
  project = await Project.findById(projectId)
    .select("_id name")
    .populate("company category", "name");

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }
}



  const session = await WorkSession.create({
    user: req.user._id,
   project: project ? project._id : null,

    date: todayStr,
    status: "active",
    segments: [],
    accumulatedMinutes: 0,
    currentStart: new Date(),
    remarks,
    customTask: project ? null : (customTask || null),

    taskType: chosenType,
    machineId: machineId || undefined,
    machineInfo: machineInfo || undefined,
  });

  console.log("✅ /start OK – new session", session._id, "taskType =", chosenType);

  res.json({
    ...session.toObject(),
   projectName: project 
  ? project.name 
  : customTask || "(Custom Task)",


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
  } else {
    // ⬅ default to “today” only when no range passed
    q.date = ymd(new Date());
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
      projectName: s.project?.name || s.customTask || "(Custom Task)",


      companyName: s.project?.company?.name || "—",
      categoryName: s.project?.category?.name || "—",
      currentStart: s.currentStart || null,
      accumulatedMinutes: s.accumulatedMinutes ?? 0,
      totalMinutes: round2(total),
      remarks: s.remarks || "",
        taskType: s.taskType || null,  
      machineId: s.machineId || null,
      machineInfo: s.machineInfo || null,
      createdAt: s.createdAt,
    };
  });

  res.json(data);
});

/* ----------------------------- ADMIN LIST ---------------------------------- */

router.get("/admin/list", requireAuth, requireRole("admin"), async (req, res) => {
  const { date, from, to, company, category, project, user, machine, taskType  } = req.query;

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
    // ⬇ NEW: filter by work type if provided and valid
  if (taskType && WORK_TYPES.includes(taskType)) {
    q.taskType = taskType;
  }

  // -------------------------------------------------------------
// Load Manual Remarks for matching date range + user
// -------------------------------------------------------------
// -------------------------------------------------------------
// Load Manual Remarks for matching date + user
// -------------------------------------------------------------
const remarkQuery = {};

// Case 1: Admin selects a single date
if (date) {
  remarkQuery.date = date;
}

// Case 2: Admin selects a date range
if (from || to) {
  remarkQuery.date = {};
  if (from) remarkQuery.date.$gte = from;
  if (to) remarkQuery.date.$lte = to;
}

// If admin filters by user
if (q.user) {
  remarkQuery.user = q.user;
}

// Fetch matching remarks
const allRemarks = await ManualRemark.find(remarkQuery).lean();

// Map remarks by "date|userId"
const remarkMap = new Map();
for (const r of allRemarks) {
  const key = `${r.date}|${r.user.toString()}`;
  if (!remarkMap.has(key)) remarkMap.set(key, []);
  remarkMap.get(key).push(r.text);
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
      manualRemarks: remarkMap.get(`${s.date}|${s.user?._id}`) || [],

      createdAt: s.createdAt,

      userId: s.user?._id || null,
      userName: s.user?.name || "(unknown)",
      userEmail: s.user?.email || "",

      projectId: s.project?._id || null,
     projectName: s.project?.name || s.customTask || "(No project)",

      companyId: s.project?.company?._id || null,
      companyName: s.project?.company?.name || "—",
      categoryId: s.project?.category?._id || null,
      categoryName: s.project?.category?.name || "—",
        taskType: s.taskType || null,  

      // expose machine in admin payload
      machineId: s.machineId || null,
      machineInfo: s.machineInfo || null,
    };
  });

  res.json(data);
});

/* ------------------------------- ADMIN EXPORT (CSV) --------------------------------
   GET /api/work-sessions/export?date=YYYY-MM-DD&from=&to=&company=&category=&project=&user=&machine=
        &group=compact|detail            // default: compact = 1 row per (Date+User+Company+Category+Project)
        &unit=hours|minutes              // default: minutes
------------------------------------------------------------------------------------ */
router.get("/export", requireAuth, requireRole("admin"), async (req, res) => {
  const { date, from, to, company, category, project, user, machine,taskType, group = "compact", unit = "minutes" } = req.query;

  const useHours = String(unit).toLowerCase() === "hours";
  const round2 = (n) => Math.round(n * 100) / 100;

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
  if (machine) q.machineId = machine;
    // work type filter
  if (taskType && WORK_TYPES.includes(taskType)) {
    q.taskType = taskType;
  }


  // We'll filter by company/category via populate match
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

  // ---- helpers ----
  const computeTotalMinutes = (s) => {
    let total = s.accumulatedMinutes ?? 0;
    if (s.status === "active" && s.currentStart) {
      total += (Date.now() - new Date(s.currentStart)) / 60000;
    }
    return Math.max(0, total);
  };

  const convertValue = (minutes) => (useHours ? round2(minutes / 60) : round2(minutes));
  const totalHeader = useHours ? "TotalHours" : "TotalMinutes";

  const fmt12 = (dt) =>
    dt
      ? new Date(dt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";

  const esc = (val) => {
    if (val == null) return "";
    const s = String(val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  if (group === "detail") {
    // ---------- per session (original) ----------
    const headers = [
      "Date",
      "Employee",
      "Email",
      "Company",
      "Category",
      "Project",
      "Status",
       "TaskType", 
      totalHeader,
      "SessionsCount",
      "Segments",
      "Remarks",
      "MachineHost",
      "MachineId",
      "CreatedAt",
      "UpdatedAt",
    ];
    const lines = [headers.join(",")];

    for (const s of filtered) {
      const minutes = computeTotalMinutes(s);
      const total = convertValue(minutes);
      const segs = Array.isArray(s.segments) ? s.segments : [];
      const segmentsPretty = segs.map((g) => `${fmt12(g.start)} - ${g.end ? fmt12(g.end) : ""}`).join("; ");
      const row = {
        Date: s.date || "",
        Employee: s.user?.name || "",
        Email: s.user?.email || "",
        Company: s.project?.company?.name || "—",
        Category: s.project?.category?.name || "—",
       Project: s.project?.name || s.customTask || "(Custom Task)",
         Status: s.status,
         TaskType: s.taskType || "",  
        [totalHeader]: total,
        SessionsCount: 1,
        Segments: segmentsPretty,
        Remarks: s.remarks || "",
        MachineHost: s.machineInfo?.hostname || "",
        MachineId: s.machineId || "",
        CreatedAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
        UpdatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
      };
      lines.push(headers.map((h) => esc(row[h])).join(","));
    }

    const csv = lines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="work-sessions_detail_${unit}.csv"`);
    return res.send(csv);
  }

  // ---------- compact (default): 1 row per Date+User+Company+Category+Project ----------
  const keyOf = (s) => [
    s.date || "",
    s.user?._id?.toString() || "",
    s.project?.company?._id?.toString() || "",
    s.project?.category?._id?.toString() || "",
    s.project?._id?.toString() || "",
  ].join("|");

  const groups = new Map();
  for (const s of filtered) {
    const k = keyOf(s);
    if (!groups.has(k)) {
      groups.set(k, {
        Date: s.date || "",
        Employee: s.user?.name || "",
        Email: s.user?.email || "",
        Company: s.project?.company?.name || "—",
        Category: s.project?.category?.name || "—",
       Project: s.project?.name || s.customTask || "(Custom Task)",

        TotalMinutes: 0,
        SessionsCount: 0,
        SegmentsCount: 0,
        Segments: [],
        Remarks: [],
        MachineHosts: new Set(),
        MachineIds: new Set(),
        FirstCreatedAt: s.createdAt ? new Date(s.createdAt).toISOString() : "",
        LastUpdatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "",
      });
    }
    const g = groups.get(k);

    const minutes = computeTotalMinutes(s);
    g.TotalMinutes = (g.TotalMinutes || 0) + minutes;
    g.SessionsCount += 1;

    const segs = Array.isArray(s.segments) ? s.segments : [];
    g.SegmentsCount += segs.length;
    if (segs.length) {
      g.Segments.push(
        ...segs.map((it) => `${fmt12(it.start)} - ${it.end ? fmt12(it.end) : ""}`)
      );
    }

    if (s.remarks) g.Remarks.push(s.remarks);
    if (s.machineInfo?.hostname) g.MachineHosts.add(s.machineInfo.hostname);
    if (s.machineId) g.MachineIds.add(s.machineId);

    if (s.createdAt) {
      const iso = new Date(s.createdAt).toISOString();
      if (!g.FirstCreatedAt || iso < g.FirstCreatedAt) g.FirstCreatedAt = iso;
    }
    if (s.updatedAt) {
      const iso = new Date(s.updatedAt).toISOString();
      if (!g.LastUpdatedAt || iso > g.LastUpdatedAt) g.LastUpdatedAt = iso;
    }
  }

  const headers = [
    "Date",
    "Employee",
    "Email",
    "Company",
    "Category",
    "Project",
    totalHeader,
    "SessionsCount",
    "SegmentsCount",
    "Segments",
    "Remarks",
    "MachineHosts",
    "MachineIds",
    "FirstCreatedAt",
    "LastUpdatedAt",
  ];

  const lines = [headers.join(",")];
  for (const g of groups.values()) {
    const row = {
      Date: g.Date,
      Employee: g.Employee,
      Email: g.Email,
      Company: g.Company,
      Category: g.Category,
      Project: g.Project,
      [totalHeader]: convertValue(g.TotalMinutes || 0),
      SessionsCount: g.SessionsCount,
      SegmentsCount: g.SegmentsCount,
      Segments: g.Segments.join("; "),
      Remarks: Array.from(new Set(g.Remarks)).join(" | "),
      MachineHosts: Array.from(g.MachineHosts).join(" | "),
      MachineIds: Array.from(g.MachineIds).join(" | "),
      FirstCreatedAt: g.FirstCreatedAt,
      LastUpdatedAt: g.LastUpdatedAt,
    };
    lines.push(headers.map((h) => esc(row[h])).join(","));
  }

  const filename = `work-sessions_compact_${unit}_${from || date || "all"}_to_${to || date || "all"}.csv`;
  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
});



export default router;