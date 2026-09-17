import express from "express";
import mongoose from "mongoose";
import WorkSession from "../models/WorkSession.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import ManualRemark from "../models/ManualRemark.js";


const router = express.Router();
const round2 = (n) => Math.round(n * 100) / 100;
const WORK_TYPES = ["Alpha", "Beta", "CR", "Rework", "poc", "Analysis", "Storyboard QA", "Output QA"]; // 🔹 work type options


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
router.post("/start", requireAuth, async (req, res) => {
  const {
    projectId,
    taskId,
    taskTitle,
    customTask,
    remarks = "",
    machineId,
    machineInfo,
    taskType,
    workType,
  } = req.body || {};

  // allow custom task or task or project
  if (!projectId && !taskId && !customTask) {
    return res.status(400).json({
      error: "Either projectId, taskId, or customTask is required.",
    });
  }

  const requestedType = taskType || workType;
  const chosenType = WORK_TYPES.includes(requestedType)
    ? requestedType
    : "Alpha";

  const todayStr = ymd(new Date());

  // 🔹 1) Auto-stop any old active sessions from previous days
  try {
    const staleSessions = await WorkSession.find({
      user: req.user._id,
      status: "active",
      date: { $ne: todayStr },
    });

    const now = new Date();
    for (const s of staleSessions) {
      const end = s.lastHeartbeatAt || now;
      if (s.currentStart) {
        s.segments.push({ start: s.currentStart, end });
        const ms = end.getTime() - new Date(s.currentStart).getTime();
        s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        s.currentStart = null;
      }
      s.status = "stopped";
      s.remarks = s.remarks ? `${s.remarks} | Auto-closed on new day` : "Auto-closed on new day";
      await s.save();
    }
  } catch (err) {
    console.warn("Could not clean stale sessions:", err.message);
  }

  // 🔹 2) Check if user ALREADY has an active session right now
  const existingActive = await WorkSession.findOne({
    user: req.user._id,
    status: "active",
    date: todayStr,
  }).sort({ createdAt: -1 });

  let project = null;
  let taskDoc = null;

  if (taskId && isValidObjectId(taskId)) {
    taskDoc = await Task.findById(taskId);
    if (taskDoc && taskDoc.project) {
      project = await Project.findById(taskDoc.project)
        .select("_id name")
        .populate("company category", "name");
    }
  }

  if (!project && projectId && isValidObjectId(projectId)) {
    project = await Project.findById(projectId)
      .select("_id name")
      .populate("company category", "name");

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
  }

  const finalTaskTitle = taskDoc ? taskDoc.title : (taskTitle || (project ? null : customTask) || null);

  if (existingActive) {
    const isSameProject = String(existingActive.project || "") === String(project ? project._id : "");
    const isSameTask = String(existingActive.task || "") === String(taskDoc ? taskDoc._id : "");
    const isSameCustom = (existingActive.customTask || "") === (project ? "" : (customTask || ""));
    const isSameType = (existingActive.taskType || "") === chosenType;

    // If it's already the exact same task running, just return it
    if (isSameProject && isSameTask && isSameCustom && isSameType) {
      return res.json({
        ...existingActive.toObject(),
        projectId: project ? project._id : null,
        projectName: project ? project.name : (customTask || "—"),
        taskId: taskDoc ? taskDoc._id : null,
        taskTitle: finalTaskTitle,
        customTask: existingActive.customTask || null,
        companyName: project?.company?.name || "—",
        categoryName: project?.category?.name || "—",
        totalMinutes: round2(existingActive.accumulatedMinutes || 0),
      });
    }

    // Otherwise, auto-pause the previous active session so user can switch seamlessly!
    const now = new Date();
    if (existingActive.currentStart) {
      existingActive.segments.push({ start: existingActive.currentStart, end: now });
      const ms = now - new Date(existingActive.currentStart);
      existingActive.accumulatedMinutes = (existingActive.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
      existingActive.currentStart = null;
    }
    existingActive.status = "paused";
    await existingActive.save();
    console.log("⏸️ Auto-paused previous session to switch:", existingActive._id);
  }

  // 🔹 3) Check if user has an existing PAUSED session for this EXACT project/task today:
  // If so, resume that session so time seamlessly accumulates!
  const matchingPaused = await WorkSession.findOne({
    user: req.user._id,
    project: project ? project._id : null,
    task: taskDoc ? taskDoc._id : null,
    customTask: project ? null : (customTask || null),
    date: todayStr,
    status: "paused",
  }).sort({ createdAt: -1 });

  if (matchingPaused) {
    matchingPaused.status = "active";
    matchingPaused.currentStart = new Date();
    matchingPaused.lastHeartbeatAt = new Date();
    matchingPaused.taskType = chosenType;
    if (machineId) matchingPaused.machineId = machineId;
    if (machineInfo) matchingPaused.machineInfo = machineInfo;
    await matchingPaused.save();
    console.log("▶️ Resumed existing paused session for this project/task:", matchingPaused._id);

    return res.json({
      ...matchingPaused.toObject(),
      projectId: project ? project._id : null,
      projectName: project ? project.name : (customTask || "—"),
      taskId: taskDoc ? taskDoc._id : null,
      taskTitle: finalTaskTitle,
      customTask: matchingPaused.customTask || null,
      companyName: project?.company?.name || "—",
      categoryName: project?.category?.name || "—",
      totalMinutes: round2(matchingPaused.accumulatedMinutes || 0),
    });
  }

  // 🔹 4) Create a new active session
  const session = await WorkSession.create({
    user: req.user._id,
    project: project ? project._id : null,
    task: taskDoc ? taskDoc._id : null,
    taskTitle: finalTaskTitle,

    date: todayStr,
    status: "active",
    segments: [],
    accumulatedMinutes: 0,
    currentStart: new Date(),
    lastHeartbeatAt: new Date(),
    remarks,
    customTask: project ? null : (customTask || null),

    taskType: chosenType,
    machineId: machineId || undefined,
    machineInfo: machineInfo || undefined,
  });

  console.log("✅ /start OK – new session", session._id, "taskType =", chosenType, "project =", project?.name, "task =", finalTaskTitle);

  res.json({
    ...session.toObject(),
    projectId: project ? project._id : null,
    projectName: project ? project.name : (customTask || "—"),
    taskId: taskDoc ? taskDoc._id : null,
    taskTitle: finalTaskTitle,
    customTask: session.customTask || null,
    companyName: project?.company?.name || "—",
    categoryName: project?.category?.name || "—",
    totalMinutes: round2(session.accumulatedMinutes || 0),
  });
});

// POST /api/work-sessions/pause
router.post("/pause", requireAuth, async (req, res) => {
  const { machineId, machineInfo } = req.body || {};
  const session = await WorkSession.findOne({ user: req.user._id, status: "active" }).sort({ createdAt: -1 });
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
  const { machineId, machineInfo, sessionId } = req.body || {};
  let session = null;
  if (sessionId && isValidObjectId(sessionId)) {
    session = await WorkSession.findOne({ _id: sessionId, user: req.user._id });
  }
  if (!session) {
    session = await WorkSession.findOne({ user: req.user._id, status: "paused" }).sort({ updatedAt: -1, createdAt: -1 });
  }
  // If the session is already active, return it immediately without error
  if (!session) {
    const alreadyActive = await WorkSession.findOne({ user: req.user._id, status: "active" }).sort({ createdAt: -1 });
    if (alreadyActive) {
      const proj = alreadyActive.project ? await Project.findById(alreadyActive.project).select("_id name").populate("company category", "name") : null;
      const tDoc = alreadyActive.task ? await Task.findById(alreadyActive.task) : null;
      return res.json({
        ...alreadyActive.toObject(),
        projectId: proj ? proj._id : null,
        projectName: proj ? proj.name : (alreadyActive.customTask || "—"),
        taskId: tDoc ? tDoc._id : null,
        taskTitle: alreadyActive.taskTitle || tDoc?.title || (alreadyActive.customTask || null),
        companyName: proj?.company?.name || "—",
        categoryName: proj?.category?.name || "—",
        totalMinutes: round2(alreadyActive.accumulatedMinutes || 0),
      });
    }
    return res.status(404).json({ error: "No paused session found to resume." });
  }

  // If there are any other active sessions, auto-pause them
  const otherActive = await WorkSession.find({ user: req.user._id, status: "active", _id: { $ne: session._id } });
  const now = new Date();
  for (const s of otherActive) {
    if (s.currentStart) {
      s.segments.push({ start: s.currentStart, end: now });
      const ms = now - new Date(s.currentStart);
      s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
      s.currentStart = null;
    }
    s.status = "paused";
    await s.save();
  }

  const todayStr = ymd(new Date());

  // 🔹 If the paused session belongs to a PREVIOUS day, finalize it and rollover to a new session today!
  if (session.date !== todayStr) {
    session.status = "stopped";
    if (!session.remarks?.includes("Auto-closed on day-end")) {
      session.remarks = session.remarks ? `${session.remarks} | Auto-closed on day-end` : "Auto-closed on day-end";
    }
    await session.save();

    // Check if there's already an active/paused session today for this project/task
    let todaySession = await WorkSession.findOne({
      user: req.user._id,
      project: session.project,
      task: session.task,
      customTask: session.customTask,
      date: todayStr,
      status: { $in: ["active", "paused"] },
    }).sort({ createdAt: -1 });

    if (todaySession) {
      todaySession.status = "active";
      todaySession.currentStart = new Date();
      todaySession.lastHeartbeatAt = new Date();
      if (machineId) todaySession.machineId = machineId;
      if (machineInfo) todaySession.machineInfo = machineInfo;
      await todaySession.save();
      session = todaySession;
    } else {
      session = await WorkSession.create({
        user: req.user._id,
        project: session.project,
        task: session.task,
        taskTitle: session.taskTitle,
        customTask: session.customTask,
        taskType: session.taskType,
        date: todayStr,
        status: "active",
        segments: [],
        accumulatedMinutes: 0,
        currentStart: new Date(),
        lastHeartbeatAt: new Date(),
        remarks: "Resumed from previous day",
        machineId: machineId || session.machineId || undefined,
        machineInfo: machineInfo || session.machineInfo || undefined,
      });
    }
  } else {
    session.status = "active";
    session.currentStart = new Date();
    session.lastHeartbeatAt = new Date();

    if (machineId) session.machineId = machineId;
    if (machineInfo) session.machineInfo = machineInfo;

    await session.save();
  }

  const project = session.project ? await Project.findById(session.project).select("_id name").populate("company category", "name") : null;
  const taskDoc = session.task ? await Task.findById(session.task) : null;

  res.json({
    ...session.toObject(),
    projectId: project ? project._id : null,
    projectName: project ? project.name : (session.customTask || "—"),
    taskId: taskDoc ? taskDoc._id : null,
    taskTitle: session.taskTitle || taskDoc?.title || (session.customTask || null),
    companyName: project?.company?.name || "—",
    categoryName: project?.category?.name || "—",
    totalMinutes: round2(session.accumulatedMinutes || 0),
  });
});

// POST /api/work-sessions/stop
router.post("/stop", requireAuth, async (req, res) => {
  const { remarks = "", machineId, machineInfo } = req.body || {};
  const session = await WorkSession.findOne({
    user: req.user._id,
    status: { $in: ["active", "paused"] },
  }).sort({ createdAt: -1 });
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
  if (remarks) {
    session.remarks = session.remarks ? `${session.remarks} | ${remarks}` : remarks;
  }

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
    .populate("task", "title taskType status")
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
      projectName: s.project?.name || (s.customTask || "—"),
      taskId: s.task?._id || s.task || null,
      taskTitle: s.task?.title || s.taskTitle || s.customTask || null,
      customTask: s.customTask || null,
      companyName: s.project?.company?.name || "—",
      categoryName: s.project?.category?.name || "—",
      currentStart: s.currentStart || null,
      accumulatedMinutes: s.accumulatedMinutes ?? 0,
      totalMinutes: round2(total),
      segments: s.segments || [],
      remarks: s.remarks || "",
      taskType: s.taskType || null,
      machineId: s.machineId || null,
      machineInfo: s.machineInfo || null,
      createdAt: s.createdAt,
    };
  });

  res.json(data);
});


// 🔥 HEARTBEAT – keep active session alive
router.post("/heartbeat", requireAuth, async (req, res) => {
  const result = await WorkSession.updateOne(
    {
      user: req.user._id,
      status: "active",
      currentStart: { $ne: null },
    },
    {
      $set: {
        lastHeartbeatAt: new Date(),
      },
    }
  );

  res.json({
    ok: true,
    updated: result.modifiedCount || 0,
  });
});

// 🔥 OFFLINE SYNC – Reconcile offline sessions and segments when reconnected
router.post("/sync-offline", requireAuth, async (req, res) => {
  try {
    const { offlineSession } = req.body || {};
    if (!offlineSession) {
      return res.status(400).json({ error: "No offline session provided." });
    }

    const todayStr = ymd(new Date());
    const targetDate = offlineSession.date || todayStr;

    let session = null;

    // 1. Try finding existing session by _id
    if (offlineSession._id && isValidObjectId(offlineSession._id)) {
      session = await WorkSession.findOne({
        _id: offlineSession._id,
        user: req.user._id,
      });
    }

    // 2. Fallback: find active or paused session for today with matching project
    if (!session) {
      const q = {
        user: req.user._id,
        date: targetDate,
      };
      if (offlineSession.projectId && isValidObjectId(offlineSession.projectId)) {
        q.project = offlineSession.projectId;
      } else if (offlineSession.customTask) {
        q.customTask = offlineSession.customTask;
      }
      session = await WorkSession.findOne(q);
    }

    // 3. Process segments & calculate accumulated time
    const inputSegments = Array.isArray(offlineSession.segments) ? offlineSession.segments : [];
    let totalMs = 0;
    const cleanSegments = [];

    for (const seg of inputSegments) {
      if (!seg.start) continue;
      const s = new Date(seg.start);
      const e = seg.end ? new Date(seg.end) : null;
      cleanSegments.push({
        start: s,
        end: e,
        manual: !!seg.manual,
        source: seg.source || "offline-sync",
      });
      if (e && e > s) {
        totalMs += (e.getTime() - s.getTime());
      }
    }

    const targetStatus = ["active", "paused", "stopped"].includes(offlineSession.status)
      ? offlineSession.status
      : "paused";

    const calcMinutes = round2(totalMs / 60000);

    if (session) {
      // Reconcile into existing session
      session.segments = cleanSegments;
      session.accumulatedMinutes = Math.max(session.accumulatedMinutes || 0, calcMinutes);
      session.status = targetStatus;
      session.currentStart = targetStatus === "active" && offlineSession.currentStart
        ? new Date(offlineSession.currentStart)
        : null;
      session.lastHeartbeatAt = new Date();

      if (offlineSession.remarks) {
        session.remarks = offlineSession.remarks;
      }
      if (offlineSession.machineId) session.machineId = offlineSession.machineId;
      if (offlineSession.machineInfo) session.machineInfo = offlineSession.machineInfo;

      if (!session.project && offlineSession.projectId && isValidObjectId(offlineSession.projectId)) {
        session.project = offlineSession.projectId;
      }
      if (!session.task && offlineSession.taskId && isValidObjectId(offlineSession.taskId)) {
        session.task = offlineSession.taskId;
      }
      if (!session.taskTitle && offlineSession.taskTitle) {
        session.taskTitle = offlineSession.taskTitle;
      }

      await session.save();
    } else {
      // Create new session from offline data
      const chosenType = WORK_TYPES.includes(offlineSession.taskType)
        ? offlineSession.taskType
        : "Alpha";

      let projectObj = null;
      if (offlineSession.projectId && isValidObjectId(offlineSession.projectId)) {
        projectObj = await Project.findById(offlineSession.projectId);
      }
      const offlineTaskId = offlineSession.taskId && isValidObjectId(offlineSession.taskId) ? offlineSession.taskId : null;
      const offlineTaskTitle = offlineSession.taskTitle || (projectObj ? null : offlineSession.customTask) || null;

      session = await WorkSession.create({
        user: req.user._id,
        project: projectObj ? projectObj._id : (offlineSession.projectId && isValidObjectId(offlineSession.projectId) ? offlineSession.projectId : null),
        task: offlineTaskId,
        taskTitle: offlineTaskTitle,
        date: targetDate,
        status: targetStatus,
        segments: cleanSegments,
        accumulatedMinutes: calcMinutes,
        currentStart: targetStatus === "active" && offlineSession.currentStart
          ? new Date(offlineSession.currentStart)
          : null,
        lastHeartbeatAt: new Date(),
        remarks: offlineSession.remarks || "Created offline",
        customTask: projectObj ? null : (offlineSession.customTask || "(Offline Task)"),
        taskType: chosenType,
        machineId: offlineSession.machineId || undefined,
        machineInfo: offlineSession.machineInfo || undefined,
      });
    }

    // Populate for response
    await session.populate({
      path: "project",
      select: "name company category",
      populate: [
        { path: "company", select: "name" },
        { path: "category", select: "name" },
      ],
    });

    return res.json({
      ok: true,
      session: {
        _id: session._id,
        date: session.date,
        status: session.status,
        projectId: session.project?._id || null,
        projectName: session.project?.name || (session.customTask || "—"),
        taskId: session.task?._id || session.task || null,
        taskTitle: session.taskTitle || session.customTask || null,
        companyName: session.project?.company?.name || "—",
        categoryName: session.project?.category?.name || "—",
        currentStart: session.currentStart || null,
        accumulatedMinutes: session.accumulatedMinutes ?? 0,
        totalMinutes: round2(session.accumulatedMinutes ?? 0),
        segments: session.segments || [],
        remarks: session.remarks || "",
        taskType: session.taskType || null,
      },
    });
  } catch (err) {
    console.error("SYNC-OFFLINE ERROR:", err);
    return res.status(500).json({ error: "Failed to sync offline work session." });
  }
});


/* ----------------------------- ADMIN LIST ---------------------------------- */

router.get("/admin/list", requireAuth, requireRole("admin"), async (req, res) => {
  const { date, from, to, company, category, project, user, machine, taskType } = req.query;

  const q = {};
  if (date) {
    q.date = date;
  } else if (from || to) {
    q.date = {};
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

  // Filter by company or category if project is not directly given
  if (company || category) {
    const projFilter = {};
    if (company && isValidObjectId(company)) projFilter.company = company;
    if (category && isValidObjectId(category)) projFilter.category = category;
    const matchingProjects = await Project.find(projFilter).select("_id").lean();
    const projectIds = matchingProjects.map((p) => p._id);
    if (q.project) {
      if (!projectIds.some((id) => id.toString() === q.project.toString())) {
        q.project = new mongoose.Types.ObjectId(); // force 0 matches
      }
    } else {
      q.project = { $in: projectIds };
    }
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
  } else if (from || to) {
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
    .populate("task", "title taskType status")
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
      projectName: s.project?.name || (s.customTask || "—"),
      taskId: s.task?._id || s.task || null,
      taskTitle: s.task?.title || s.taskTitle || s.customTask || null,
      customTask: s.customTask || null,

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
  const { date, from, to, company, category, project, user, machine, taskType, group = "compact", unit = "minutes" } = req.query;

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
    .populate("task", "title taskType status")
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
      "Task Name",
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
        Project: s.project?.name || (s.customTask || "—"),
        "Task Name": s.task?.title || s.taskTitle || s.customTask || "—",
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

  // ---------- compact (default): 1 row per Date+User+Company+Category+Project+Task ----------
  const keyOf = (s) => [
    s.date || "",
    s.user?._id?.toString() || "",
    s.project?.company?._id?.toString() || "",
    s.project?.category?._id?.toString() || "",
    s.project?._id?.toString() || "",
    s.task?._id?.toString() || s.taskTitle || s.customTask || "",
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
        Project: s.project?.name || (s.customTask || "—"),
        TaskName: s.task?.title || s.taskTitle || s.customTask || "—",

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
    "Task Name",
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
      "Task Name": g.TaskName,
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