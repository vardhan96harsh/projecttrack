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

const IST_OFFSET_MS = 5.5 * 3600 * 1000; // 5 hours 30 mins (Asia/Kolkata / IST)

/**
 * Calculates effective pause duration in minutes excluding lunch break (2:00 PM to 3:00 PM IST / 14:00 - 15:00 IST).
 * Any pause overlap between 14:00:00 and 15:00:00 IST is deducted so lunch is not counted as unauthorized pause.
 * 🔒 Timezone-independent: works consistently whether server runs in UTC, IST, or any other timezone.
 */
function calculatePauseDurationExcludingLunch(startInput, endInput) {
  if (!startInput || !endInput) {
    return { totalMinutes: 0, lunchOverlapMinutes: 0, pauseMinutes: 0, wasDuringLunch: false };
  }

  const startDate = new Date(startInput);
  const endDate = new Date(endInput);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    return { totalMinutes: 0, lunchOverlapMinutes: 0, pauseMinutes: 0, wasDuringLunch: false };
  }

  const totalMs = endDate.getTime() - startDate.getTime();
  let lunchOverlapMs = 0;

  // Convert to IST timeline for day iteration
  const istStart = new Date(startDate.getTime() + IST_OFFSET_MS);
  const istEnd = new Date(endDate.getTime() + IST_OFFSET_MS);

  let curDayUtc = Date.UTC(istStart.getUTCFullYear(), istStart.getUTCMonth(), istStart.getUTCDate());
  const lastDayUtc = Date.UTC(istEnd.getUTCFullYear(), istEnd.getUTCMonth(), istEnd.getUTCDate());

  while (curDayUtc <= lastDayUtc) {
    // 14:00:00 to 15:00:00 IST in epoch ms
    const lunchStartMs = curDayUtc + 14 * 3600 * 1000 - IST_OFFSET_MS;
    const lunchEndMs = curDayUtc + 15 * 3600 * 1000 - IST_OFFSET_MS;

    const overlapStart = Math.max(startDate.getTime(), lunchStartMs);
    const overlapEnd = Math.min(endDate.getTime(), lunchEndMs);

    if (overlapEnd > overlapStart) {
      lunchOverlapMs += (overlapEnd - overlapStart);
    }

    curDayUtc += 24 * 3600 * 1000;
  }

  const effectiveMs = Math.max(0, totalMs - lunchOverlapMs);
  const totalMinutes = round2(totalMs / 60000);
  const lunchOverlapMinutes = round2(lunchOverlapMs / 60000);
  const pauseMinutes = round2(effectiveMs / 60000);

  return {
    totalMinutes,
    lunchOverlapMinutes,
    pauseMinutes,
    wasDuringLunch: lunchOverlapMinutes > 0,
  };
}

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

  // 🔹 1) Auto-stop any old active OR paused sessions from previous days
  try {
    const staleSessions = await WorkSession.find({
      user: req.user._id,
      status: { $in: ["active", "paused"] },
      date: { $ne: todayStr },
    });

    const now = new Date();
    for (const s of staleSessions) {
      const end = s.pausedAt || s.lastHeartbeatAt || now;
      if (s.currentStart) {
        s.segments.push({ start: s.currentStart, end, source: "auto-stop-new-day" });
        const ms = end.getTime() - new Date(s.currentStart).getTime();
        s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        s.currentStart = null;
      }
      s.status = "stopped";
      if (!s.remarks?.includes("Auto-closed on new day")) {
        s.remarks = s.remarks ? `${s.remarks} | Auto-closed on new day` : "Auto-closed on new day";
      }
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
      let liveTotal = existingActive.accumulatedMinutes || 0;
      if (existingActive.currentStart) {
        liveTotal += Math.max(0, (Date.now() - new Date(existingActive.currentStart).getTime()) / 60000);
      }
      return res.json({
        ...existingActive.toObject(),
        projectId: project ? project._id : null,
        projectName: project ? project.name : (customTask || "—"),
        taskId: taskDoc ? taskDoc._id : null,
        taskTitle: finalTaskTitle,
        customTask: existingActive.customTask || null,
        companyName: project?.company?.name || "—",
        categoryName: project?.category?.name || "—",
        totalMinutes: round2(liveTotal),
      });
    }

    // If previous active session is from a past day, close it properly!
    if (existingActive.date && existingActive.date < todayStr) {
      const end = existingActive.lastHeartbeatAt || (existingActive.currentStart ? new Date(new Date(existingActive.currentStart).getTime() + 15 * 60 * 1000) : new Date());
      if (existingActive.currentStart) {
        existingActive.segments.push({ start: existingActive.currentStart, end, source: "auto-stop-day-end" });
        const ms = end.getTime() - new Date(existingActive.currentStart).getTime();
        existingActive.accumulatedMinutes = (existingActive.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        existingActive.currentStart = null;
      }
      existingActive.status = "stopped";
      existingActive.remarks = existingActive.remarks ? `${existingActive.remarks} | Auto-closed on day-end` : "Auto-closed on day-end";
      await existingActive.save();
    } else {
      // Otherwise, auto-pause the previous active session so user can switch seamlessly!
      const now = new Date();
      if (existingActive.currentStart) {
        existingActive.segments.push({ start: existingActive.currentStart, end: now });
        const ms = now - new Date(existingActive.currentStart);
        existingActive.accumulatedMinutes = (existingActive.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        existingActive.currentStart = null;
      }
      existingActive.status = "paused";
      existingActive.pausedAt = now;
      await existingActive.save();
      console.log("⏸️ Auto-paused previous session to switch:", existingActive._id);
    }
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
    taskType: chosenType,
  }).sort({ createdAt: -1 });

  if (matchingPaused) {
    matchingPaused.status = "active";
    matchingPaused.pausedAt = null;
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
  const { machineId, machineInfo, sessionId } = req.body || {};
  let session = null;
  if (sessionId && isValidObjectId(sessionId)) {
    session = await WorkSession.findOne({ _id: sessionId, user: req.user._id });
  }
  if (!session) {
    session = await WorkSession.findOne({ user: req.user._id, status: "active" }).sort({ createdAt: -1 });
  }

  // Idempotent: If session is already paused, return it safely without 404
  if (!session) {
    const alreadyPaused = await WorkSession.findOne({ user: req.user._id, status: "paused" }).sort({ createdAt: -1 });
    if (alreadyPaused) {
      return res.json({ ...alreadyPaused.toObject(), totalMinutes: round2(alreadyPaused.accumulatedMinutes || 0) });
    }
    return res.status(404).json({ error: "No active session found." });
  }

  if (session.status === "paused") {
    return res.json({ ...session.toObject(), totalMinutes: round2(session.accumulatedMinutes || 0) });
  }

  const now = new Date();
  if (session.currentStart) {
    session.segments.push({ start: session.currentStart, end: now });
    const ms = now - new Date(session.currentStart);
    const minutes = ms > 0 ? (ms / 60000) : 0;
    session.accumulatedMinutes = (session.accumulatedMinutes || 0) + minutes;
    session.currentStart = null;
  }

  session.status = "paused";
  session.pausedAt = now;

  if (machineId) session.machineId = machineId;
  if (machineInfo) session.machineInfo = machineInfo;

  await session.save();
  res.json({ ...session.toObject(), totalMinutes: round2(session.accumulatedMinutes || 0) });
});

// POST /api/work-sessions/resume
router.post("/resume", requireAuth, async (req, res) => {
  const { machineId, machineInfo, sessionId } = req.body || {};
  const todayStr = ymd(new Date());
  let session = null;
  if (sessionId && isValidObjectId(sessionId)) {
    session = await WorkSession.findOne({ _id: sessionId, user: req.user._id });
  }
  if (!session) {
    // Prefer today's paused session first
    session = await WorkSession.findOne({ user: req.user._id, status: "paused", date: todayStr }).sort({ updatedAt: -1, createdAt: -1 });
  }
  if (!session) {
    // Fallback: any paused session
    session = await WorkSession.findOne({ user: req.user._id, status: "paused" }).sort({ updatedAt: -1, createdAt: -1 });
  }
  // If the session is already active, return it immediately without error
  if (!session) {
    const alreadyActive = await WorkSession.findOne({ user: req.user._id, status: "active", date: todayStr }).sort({ createdAt: -1 });
    if (alreadyActive) {
      const proj = alreadyActive.project ? await Project.findById(alreadyActive.project).select("_id name").populate("company category", "name") : null;
      const tDoc = alreadyActive.task ? await Task.findById(alreadyActive.task) : null;
      let total = alreadyActive.accumulatedMinutes || 0;
      if (alreadyActive.currentStart) {
        total += Math.max(0, (Date.now() - new Date(alreadyActive.currentStart).getTime()) / 60000);
      }
      return res.json({
        ...alreadyActive.toObject(),
        projectId: proj ? proj._id : null,
        projectName: proj ? proj.name : (alreadyActive.customTask || "—"),
        taskId: tDoc ? tDoc._id : null,
        taskTitle: alreadyActive.taskTitle || tDoc?.title || (alreadyActive.customTask || null),
        companyName: proj?.company?.name || "—",
        categoryName: proj?.category?.name || "—",
        totalMinutes: round2(total),
      });
    }
    return res.status(404).json({ error: "No paused session found to resume." });
  }

  // If there are any other active sessions, auto-pause them
  const otherActive = await WorkSession.find({ user: req.user._id, status: "active", _id: { $ne: session._id } });
  const now = new Date();
  for (const s of otherActive) {
    if (s.date && s.date < todayStr) {
      const end = s.lastHeartbeatAt || (s.currentStart ? new Date(new Date(s.currentStart).getTime() + 15 * 60 * 1000) : now);
      if (s.currentStart) {
        s.segments.push({ start: s.currentStart, end, source: "auto-stop-day-end" });
        const ms = end.getTime() - new Date(s.currentStart).getTime();
        s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        s.currentStart = null;
      }
      s.status = "stopped";
      s.remarks = s.remarks ? `${s.remarks} | Auto-closed on day-end` : "Auto-closed on day-end";
      await s.save();
    } else {
      if (s.currentStart) {
        s.segments.push({ start: s.currentStart, end: now });
        const ms = now - new Date(s.currentStart);
        s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        s.currentStart = null;
      }
      s.status = "paused";
      s.pausedAt = now;
      await s.save();
    }
  }

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
      taskType: session.taskType,
      date: todayStr,
      status: { $in: ["active", "paused"] },
    }).sort({ createdAt: -1 });

    if (todaySession) {
      if (todaySession.status !== "active") {
        todaySession.status = "active";
        todaySession.pausedAt = null;
        todaySession.currentStart = new Date();
      } else if (!todaySession.currentStart) {
        todaySession.currentStart = new Date();
      }
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
    // 🔹 Today's session:
    // If ALREADY active, NEVER overwrite currentStart! Keep ongoing work time intact!
    if (session.status !== "active") {
      session.status = "active";
      session.pausedAt = null;
      session.currentStart = new Date();
    } else if (!session.currentStart) {
      session.currentStart = new Date();
    }
    session.pausedAt = null;
    session.lastHeartbeatAt = new Date();

    if (machineId) session.machineId = machineId;
    if (machineInfo) session.machineInfo = machineInfo;

    await session.save();
  }

  const project = session.project ? await Project.findById(session.project).select("_id name").populate("company category", "name") : null;
  const taskDoc = session.task ? await Task.findById(session.task) : null;

  let totalMinutes = session.accumulatedMinutes || 0;
  if (session.status === "active" && session.currentStart) {
    totalMinutes += Math.max(0, (Date.now() - new Date(session.currentStart).getTime()) / 60000);
  }

  res.json({
    ...session.toObject(),
    projectId: project ? project._id : null,
    projectName: project ? project.name : (session.customTask || "—"),
    taskId: taskDoc ? taskDoc._id : null,
    taskTitle: session.taskTitle || taskDoc?.title || (session.customTask || null),
    companyName: project?.company?.name || "—",
    categoryName: project?.category?.name || "—",
    totalMinutes: round2(totalMinutes),
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
  session.pausedAt = null;
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
  const todayStr = ymd(new Date());

  // Proactively finalize any abandoned active or paused sessions from previous days for this employee
  try {
    await WorkSession.updateMany(
      {
        user: req.user._id,
        status: { $in: ["active", "paused"] },
        date: { $lt: todayStr },
      },
      {
        $set: {
          status: "stopped",
          currentStart: null,
        },
      }
    );
  } catch (err) {
    console.warn("Could not auto-close past sessions on GET /my:", err.message);
  }

  const q = { user: req.user._id };

  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = from;
    if (to) q.date.$lte = to;
  } else {
    q.date = todayStr;
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
    let accMins = s.accumulatedMinutes ?? 0;
    // Guard against corrupt runaway accumulatedMinutes (> 1440 min/day) from previous sync bugs
    if (accMins > 1440 && Array.isArray(s.segments) && s.segments.length > 0) {
      let segMs = 0;
      for (const seg of s.segments) {
        if (seg.start && seg.end) {
          const st = new Date(seg.start).getTime();
          const et = new Date(seg.end).getTime();
          if (et > st) segMs += (et - st);
        }
      }
      accMins = Math.min(1440, round2(segMs / 60000));
    }

    let total = accMins;

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
      accumulatedMinutes: accMins,
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

    const chosenType = WORK_TYPES.includes(offlineSession.taskType)
      ? offlineSession.taskType
      : "Alpha";

    // 2. Fallback: find active or paused session for today with matching project and taskType
    if (!session) {
      const q = {
        user: req.user._id,
        date: targetDate,
        taskType: chosenType,
        status: { $in: ["active", "paused"] },
      };
      if (offlineSession.projectId && isValidObjectId(offlineSession.projectId)) {
        q.project = offlineSession.projectId;
      } else if (offlineSession.customTask) {
        q.customTask = offlineSession.customTask;
      }
      session = await WorkSession.findOne(q);
    }

    // 3. Process segments safely
    const inputSegments = Array.isArray(offlineSession.segments) ? offlineSession.segments : [];
    const cleanSegments = [];

    for (const seg of inputSegments) {
      if (!seg.start) continue;
      const s = new Date(seg.start);
      const e = seg.end ? new Date(seg.end) : null;
      if (isNaN(s.getTime())) continue;
      if (e && isNaN(e.getTime())) continue;

      cleanSegments.push({
        start: s,
        end: e,
        manual: !!seg.manual,
        source: seg.source || "offline-sync",
      });
    }

    const targetStatus = ["active", "paused", "stopped"].includes(offlineSession.status)
      ? offlineSession.status
      : "paused";

    if (session) {
      // Reconcile into existing session with strict deduplication
      const existingSegs = Array.isArray(session.segments) ? session.segments : [];
      const mergedSegments = [...existingSegs];

      for (const inSeg of cleanSegments) {
        if (!inSeg.start) continue;
        const inStart = inSeg.start.getTime();
        const inEnd = inSeg.end ? inSeg.end.getTime() : null;

        // Check if an existing segment matches this start time (within 3s tolerance)
        const matchIdx = mergedSegments.findIndex((ex) => {
          if (!ex.start) return false;
          return Math.abs(new Date(ex.start).getTime() - inStart) < 3000;
        });

        if (matchIdx >= 0) {
          const exSeg = mergedSegments[matchIdx];
          const exEnd = exSeg.end ? new Date(exSeg.end).getTime() : null;
          // If incoming segment has a more recent / complete end time, update existing end
          if (inEnd && (!exEnd || inEnd > exEnd)) {
            exSeg.end = inSeg.end;
          }
        } else {
          // Truly new segment
          mergedSegments.push(inSeg);
        }
      }

      // If session was auto-paused due to missing heartbeat, but user was active continuous offline
      if (targetStatus === "active" && offlineSession.currentStart) {
        const offStartTime = new Date(offlineSession.currentStart).getTime();
        for (let i = mergedSegments.length - 1; i >= 0; i--) {
          const seg = mergedSegments[i];
          if (
            seg.source === "auto-pause-heartbeat" ||
            (session.remarks && session.remarks.includes("Auto-paused (no heartbeat)") &&
             Math.abs(new Date(seg.start).getTime() - offStartTime) < 5000)
          ) {
            mergedSegments.splice(i, 1);
          }
        }
      }

      // Sort segments chronologically
      mergedSegments.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      session.segments = mergedSegments;

      // Recalculate accumulated minutes strictly from all unique closed segments
      let totalMergedMs = 0;
      for (const seg of session.segments) {
        if (seg.start && seg.end) {
          const sTime = new Date(seg.start).getTime();
          const eTime = new Date(seg.end).getTime();
          if (eTime > sTime) {
            totalMergedMs += (eTime - sTime);
          }
        }
      }
      session.accumulatedMinutes = round2(totalMergedMs / 60000);

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

      let totalNewMs = 0;
      for (const seg of cleanSegments) {
        if (seg.start && seg.end) {
          const sTime = new Date(seg.start).getTime();
          const eTime = new Date(seg.end).getTime();
          if (eTime > sTime) {
            totalNewMs += (eTime - sTime);
          }
        }
      }
      const calcMinutes = round2(totalNewMs / 60000);

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

    const liveActiveMinutes = session.status === "active" && session.currentStart
      ? Math.max(0, (Date.now() - new Date(session.currentStart).getTime()) / 60000)
      : 0;

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
        totalMinutes: round2((session.accumulatedMinutes ?? 0) + liveActiveMinutes),
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


/* ------------------------ ADMIN LIVE USER STATUS ---------------------------
   GET /api/work-sessions/admin/live-status
   Returns real-time list of all employees and their tracker usage status for today:
   - Online (Active working / Paused)
   - Offline (Completed shift / Not started today)
----------------------------------------------------------------------------- */
router.get("/admin/live-status", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const todayStr = ymd(new Date());

    // 1. Fetch all active employees (excluding admin and superadmin accounts)
    const employees = await User.find({
      status: { $ne: "inactive" },
      role: { $nin: ["admin", "superadmin"] },
    })
      .select("_id name email employeeId designation role gender")
      .collation({ locale: "en", strength: 2 })
      .sort({ name: 1 })
      .lean();

    // 2. Fetch today's work sessions
    const sessions = await WorkSession.find({ date: todayStr })
      .populate({
        path: "project",
        select: "name category company",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .populate("task", "title taskType status")
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    // 3. Group sessions by user
    const sessionsByUser = new Map();
    for (const s of sessions) {
      const uId = String(s.user);
      if (!sessionsByUser.has(uId)) {
        sessionsByUser.set(uId, []);
      }
      sessionsByUser.get(uId).push(s);
    }

    let onlineCount = 0;
    let activeCount = 0;
    let pausedCount = 0;
    let offlineCount = 0;
    let totalTrackedMinutesToday = 0;

    const userStatuses = employees.map((emp) => {
      const uId = String(emp._id);
      const userSessions = sessionsByUser.get(uId) || [];

      // Calculate total minutes worked today
      let todayMinutes = 0;
      for (const s of userSessions) {
        let accMins = s.accumulatedMinutes ?? 0;
        if (accMins > 1440 && Array.isArray(s.segments) && s.segments.length > 0) {
          let segMs = 0;
          for (const seg of s.segments) {
            if (seg.start && seg.end) {
              const st = new Date(seg.start).getTime();
              const et = new Date(seg.end).getTime();
              if (et > st) segMs += (et - st);
            }
          }
          accMins = Math.min(1440, round2(segMs / 60000));
        }
        let sessionTotal = accMins;
        if (s.status === "active" && s.currentStart) {
          sessionTotal += Math.max(0, (Date.now() - new Date(s.currentStart).getTime()) / 60000);
        }
        todayMinutes += sessionTotal;
      }
      todayMinutes = round2(todayMinutes);
      totalTrackedMinutesToday += todayMinutes;

      // Find current active session or paused session
      const runningSession = userSessions.find((s) => s.status === "active");
      const pausedSession = !runningSession ? userSessions.find((s) => s.status === "paused") : null;
      const latestSession = runningSession || pausedSession || (userSessions.length > 0 ? userSessions[0] : null);

      let status = "offline_not_started";
      let isOnline = false;

      if (runningSession) {
        status = "active";
        isOnline = true;
        onlineCount++;
        activeCount++;
      } else if (pausedSession) {
        status = "paused";
        isOnline = true;
        onlineCount++;
        pausedCount++;
      } else if (userSessions.length > 0) {
        status = "offline_completed";
        offlineCount++;
      } else {
        status = "offline_not_started";
        offlineCount++;
      }

      let currentSessionData = null;
      if (latestSession) {
        let liveDuration = latestSession.accumulatedMinutes || 0;
        if (latestSession.status === "active" && latestSession.currentStart) {
          liveDuration += Math.max(0, (Date.now() - new Date(latestSession.currentStart).getTime()) / 60000);
        }

        currentSessionData = {
          _id: latestSession._id,
          status: latestSession.status,
          projectId: latestSession.project?._id || null,
          projectName: latestSession.project?.name || (latestSession.customTask || "—"),
          companyName: latestSession.project?.company?.name || "—",
          categoryName: latestSession.project?.category?.name || "—",
          taskId: latestSession.task?._id || latestSession.task || null,
          taskTitle: latestSession.task?.title || latestSession.taskTitle || latestSession.customTask || null,
          customTask: latestSession.customTask || null,
          currentStart: latestSession.currentStart || null,
          pausedAt: latestSession.pausedAt || null,
          lastHeartbeatAt: latestSession.lastHeartbeatAt || null,
          machineId: latestSession.machineId || null,
          machineInfo: latestSession.machineInfo || null,
          sessionMinutes: round2(liveDuration),
        };
      }

      return {
        userId: emp._id,
        name: emp.name,
        email: emp.email,
        employeeId: emp.employeeId || "—",
        designation: emp.designation || "Employee",
        role: emp.role,
        isOnline,
        status, // "active" | "paused" | "offline_completed" | "offline_not_started"
        currentSession: currentSessionData,
        todaySessionsCount: userSessions.length,
        todayTotalMinutes: todayMinutes,
        lastHeartbeatAt: latestSession?.lastHeartbeatAt || latestSession?.currentStart || latestSession?.updatedAt || null,
      };
    });

    res.json({
      success: true,
      date: todayStr,
      summary: {
        totalEmployees: employees.length,
        onlineCount,
        activeCount,
        pausedCount,
        offlineCount,
        totalTrackedHours: round2(totalTrackedMinutesToday / 60),
      },
      users: userStatuses,
    });
  } catch (err) {
    console.error("ADMIN LIVE STATUS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch live employee status." });
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
    if (user === "unknown") {
      q.$or = [{ user: null }, { user: { $exists: false } }];
    } else if (isValidObjectId(user)) {
      q.user = new mongoose.Types.ObjectId(user);
    } else {
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
    .populate({ path: "user", select: "name email employeeId designation role" })
    .sort({ createdAt: -1 })
    .lean();

  const data = rows.map((s) => {
    let accMins = s.accumulatedMinutes ?? 0;
    if (accMins > 1440 && Array.isArray(s.segments) && s.segments.length > 0) {
      let segMs = 0;
      for (const seg of s.segments) {
        if (seg.start && seg.end) {
          const st = new Date(seg.start).getTime();
          const et = new Date(seg.end).getTime();
          if (et > st) segMs += (et - st);
        }
      }
      accMins = Math.min(1440, round2(segMs / 60000));
    }
    let total = accMins;
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
      userEmployeeId: s.user?.employeeId || null,
      userDesignation: s.user?.designation || null,
      userRole: s.user?.role || "employee",

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
      pausedAt: s.pausedAt || null,
      currentStart: s.currentStart || null,
      lastHeartbeatAt: s.lastHeartbeatAt || null,
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
  if (date) {
    q.date = date;
  } else if (from || to) {
    q.date = {};
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


  if (company && !isValidObjectId(company)) {
    return res.status(400).json({ error: "company must be a valid ObjectId" });
  }
  if (category && !isValidObjectId(category)) {
    return res.status(400).json({ error: "category must be a valid ObjectId" });
  }

  const companyMatch = company ? { _id: new mongoose.Types.ObjectId(company) } : {};
  const categoryMatch = category ? { _id: new mongoose.Types.ObjectId(category) } : {};

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

// 🔔 GET /api/work-sessions/admin/paused-alerts
// Returns active notifications for Admin & Super Admin when employee sessions are paused >= 10 minutes
router.get("/admin/paused-alerts", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const minMinutes = Math.max(1, Number(req.query.minMinutes) || 10);
    const todayStr = ymd(new Date());

    // 1. Find user IDs who currently have an active session running today
    const activeSessions = await WorkSession.find({
      date: todayStr,
      status: "active",
    }).select("user");
    const activeUserIds = new Set(activeSessions.map((s) => String(s.user)));

    // 2. Query paused sessions for today
    const pausedSessions = await WorkSession.find({
      date: todayStr,
      status: "paused",
    })
      .populate("user", "name email employeeId designation role")
      .populate("project", "name")
      .populate("task", "title")
      .sort({ updatedAt: -1, createdAt: -1 });

    const now = new Date();
    const alertsByUser = new Map();

    for (const s of pausedSessions) {
      if (!s.user) continue;
      const uId = String(s.user._id);

      // If this employee is actively working on another task right now, don't alert
      if (activeUserIds.has(uId)) continue;

      // Only take the most recent paused session per employee
      if (alertsByUser.has(uId)) continue;

      // Determine pause timestamp
      let pauseDate = s.pausedAt;
      if (!pauseDate) {
        if (s.segments && s.segments.length > 0) {
          const lastSeg = s.segments[s.segments.length - 1];
          pauseDate = lastSeg.end || lastSeg.start;
        }
      }
      if (!pauseDate) {
        pauseDate = s.updatedAt || s.createdAt;
      }

      const durationInfo = calculatePauseDurationExcludingLunch(pauseDate, now);
      const elapsedMinutes = Math.floor(durationInfo.pauseMinutes);

      if (elapsedMinutes >= minMinutes) {
        const empName = s.user.name || "Employee";
        const projName = s.project?.name || s.customTask || "—";
        const tTitle = s.taskTitle || s.task?.title || s.customTask || "General Task";

        alertsByUser.set(uId, {
          sessionId: s._id,
          userId: s.user._id,
          employeeName: empName,
          employeeId: s.user.employeeId || "—",
          employeeEmail: s.user.email || "",
          designation: s.user.designation || "",
          role: s.user.role || "employee",
          projectName: projName,
          taskTitle: tTitle,
          pausedAt: pauseDate,
          pausedMinutes: elapsedMinutes,
          rawElapsedMinutes: Math.floor(durationInfo.totalMinutes),
          lunchDeductedMinutes: Math.floor(durationInfo.lunchOverlapMinutes),
          message: `${empName}'s session has been paused for ${elapsedMinutes} minutes${durationInfo.lunchOverlapMinutes > 0 ? " (excl. lunch)" : ""}${s.project?.name ? ` on ${s.project.name}` : ""}.`,
        });
      }
    }

    const alerts = Array.from(alertsByUser.values()).sort((a, b) => b.pausedMinutes - a.pausedMinutes);

    res.json({
      success: true,
      count: alerts.length,
      alerts,
      minMinutes,
      serverTime: now,
    });
  } catch (error) {
    console.error("Error fetching paused session alerts:", error);
    res.status(500).json({ error: "Failed to fetch paused session alerts", details: error.message });
  }
});

// 📋 GET /api/work-sessions/admin/pause-logs
// Prepares detailed pause logs for all pauses (1 time, 10 times, etc.) across sessions
router.get("/admin/pause-logs", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { date, from, to, user, project, company, category, minMinutes } = req.query;

    const q = {};
    if (date) {
      q.date = date;
    } else if (from || to) {
      q.date = {};
      if (from) q.date.$gte = from;
      if (to) q.date.$lte = to;
    } else {
      q.date = ymd(new Date());
    }

    if (user && isValidObjectId(user)) {
      q.user = new mongoose.Types.ObjectId(user);
    }
    if (project && isValidObjectId(project)) {
      q.project = new mongoose.Types.ObjectId(project);
    }

    // Filter by company/category if provided
    if (company || category) {
      const projFilter = {};
      if (company && isValidObjectId(company)) projFilter.company = company;
      if (category && isValidObjectId(category)) projFilter.category = category;
      const matchingProjects = await Project.find(projFilter).select("_id").lean();
      const projectIds = matchingProjects.map((p) => p._id);
      if (q.project) {
        if (!projectIds.some((id) => id.toString() === q.project.toString())) {
          q.project = new mongoose.Types.ObjectId();
        }
      } else {
        q.project = { $in: projectIds };
      }
    }

    const sessions = await WorkSession.find(q)
      .populate("user", "name email employeeId designation role")
      .populate("project", "name company category")
      .populate("task", "title")
      .sort({ createdAt: -1 })
      .lean();

    const minThreshold = Math.max(10, Number(minMinutes) || 10);
    const now = new Date();
    const allPauseLogs = [];
    const userSummaryMap = new Map();

    for (const s of sessions) {
      if (!s.user) continue;

      const uId = String(s.user._id);
      const uName = s.user.name || "Unknown";
      const uEmail = s.user.email || "";
      const empId = s.user.employeeId || "—";
      const desig = s.user.designation || "—";
      const uRole = s.user.role || "employee";
      const projName = s.project?.name || s.customTask || "—";
      const tTitle = s.taskTitle || s.task?.title || s.customTask || "—";

      // Initialize user summary if needed
      if (!userSummaryMap.has(uId)) {
        userSummaryMap.set(uId, {
          userId: uId,
          employeeName: uName,
          employeeEmail: uEmail,
          employeeId: empId,
          designation: desig,
          role: uRole,
          totalPauseCount: 0,
          totalPauseMinutes: 0,
          maxPauseMinutes: 0,
          isCurrentlyPaused: false,
          logs: [],
        });
      }

      const userSummary = userSummaryMap.get(uId);

      // Process segments to find all pause intervals
      const rawSegments = Array.isArray(s.segments) ? [...s.segments] : [];
      // Sort segments by start time
      rawSegments.sort((a, b) => new Date(a.start) - new Date(b.start));

      let pauseIndexInSession = 1;

      // 1. Pauses between completed segments
      for (let i = 0; i < rawSegments.length - 1; i++) {
        const segEnd = rawSegments[i]?.end ? new Date(rawSegments[i].end) : null;
        const nextStart = rawSegments[i + 1]?.start ? new Date(rawSegments[i + 1].start) : null;

        if (segEnd && nextStart && nextStart > segEnd) {
          const durationInfo = calculatePauseDurationExcludingLunch(segEnd, nextStart);
          const pauseMinutes = durationInfo.pauseMinutes;

          // Strictly filter for pauses >= 10 minutes (excluding 2 PM - 3 PM lunch)
          if (pauseMinutes >= minThreshold) {
            const pauseLog = {
              pauseId: `${s._id}_p_${i}`,
              sessionId: s._id,
              date: s.date,
              userId: uId,
              employeeName: uName,
              employeeEmail: uEmail,
              employeeId: empId,
              designation: desig,
              role: uRole,
              projectName: projName,
              taskTitle: tTitle,
              pauseNumber: pauseIndexInSession++,
              pauseStart: segEnd,
              pauseEnd: nextStart,
              pauseMinutes,
              rawTotalMinutes: durationInfo.totalMinutes,
              lunchDeductedMinutes: durationInfo.lunchOverlapMinutes,
              isOngoing: false,
            };

            allPauseLogs.push(pauseLog);
            userSummary.totalPauseCount += 1;
            userSummary.totalPauseMinutes = round2(userSummary.totalPauseMinutes + pauseMinutes);
            if (pauseMinutes > userSummary.maxPauseMinutes) {
              userSummary.maxPauseMinutes = pauseMinutes;
            }
            userSummary.logs.push(pauseLog);
          }
        }
      }

      // 2. Ongoing pause (if session is currently paused)
      if (s.status === "paused") {
        let pauseStart = s.pausedAt;
        if (!pauseStart && rawSegments.length > 0) {
          pauseStart = rawSegments[rawSegments.length - 1].end || rawSegments[rawSegments.length - 1].start;
        }
        if (!pauseStart) {
          pauseStart = s.updatedAt || s.createdAt;
        }

        const durationInfo = calculatePauseDurationExcludingLunch(pauseStart, now);
        const pauseMinutes = durationInfo.pauseMinutes;

        // Strictly filter for pauses >= 10 minutes (excluding 2 PM - 3 PM lunch)
        if (pauseMinutes >= minThreshold) {
          const ongoingLog = {
            pauseId: `${s._id}_ongoing`,
            sessionId: s._id,
            date: s.date,
            userId: uId,
            employeeName: uName,
            employeeEmail: uEmail,
            employeeId: empId,
            designation: desig,
            role: uRole,
            projectName: projName,
            taskTitle: tTitle,
            pauseNumber: pauseIndexInSession++,
            pauseStart: new Date(pauseStart),
            pauseEnd: null, // ongoing
            pauseMinutes,
            rawTotalMinutes: durationInfo.totalMinutes,
            lunchDeductedMinutes: durationInfo.lunchOverlapMinutes,
            isOngoing: true,
          };

          allPauseLogs.push(ongoingLog);
          userSummary.totalPauseCount += 1;
          userSummary.totalPauseMinutes = round2(userSummary.totalPauseMinutes + pauseMinutes);
          if (pauseMinutes > userSummary.maxPauseMinutes) {
            userSummary.maxPauseMinutes = pauseMinutes;
          }
          userSummary.isCurrentlyPaused = true;
          userSummary.logs.push(ongoingLog);
        }
      }
    }

    // Sort logs chronologically descending (newest pause first)
    allPauseLogs.sort((a, b) => new Date(b.pauseStart) - new Date(a.pauseStart));

    // Convert user summary map to array sorted by total pause minutes descending
    const userSummaries = Array.from(userSummaryMap.values())
      .filter((u) => u.totalPauseCount > 0)
      .sort((a, b) => b.totalPauseMinutes - a.totalPauseMinutes);

    res.json({
      success: true,
      count: allPauseLogs.length,
      logs: allPauseLogs,
      userSummaries,
      minThreshold,
      lunchWindow: { start: "14:00", end: "15:00", description: "Lunch time (2:00 PM - 3:00 PM) excluded from pauses" },
      serverTime: now,
    });
  } catch (error) {
    console.error("Error generating pause logs:", error);
    res.status(500).json({ error: "Failed to generate pause logs", details: error.message });
  }
});

export default router;