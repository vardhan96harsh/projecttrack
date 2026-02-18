import express from "express";
import mongoose from "mongoose";
import ManualRemark from "../models/ManualRemark.js";
import { requireAuth } from "../middleware/auth.js";
import WorkSession from "../models/WorkSession.js";


const router = express.Router();

/* =====================================================
   USER ROUTES (EMPLOYEE)
   ===================================================== */

// Get logged-in user's remarks
router.get("/", requireAuth, async (req, res) => {
  const list = await ManualRemark.find({ user: req.user._id })
   .populate("project", "name") 
    .sort({ createdAt: -1 })
    .lean();

  res.json(list);
});

router.post("/", requireAuth, async (req, res) => {
  const { text, requestedMinutes, project, taskType, customTask } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Remark text cannot be empty" });
  }

  if (!requestedMinutes || requestedMinutes <= 0) {
    return res.status(400).json({ error: "Requested time is required" });
  }

  if (!project && !customTask) {
    return res.status(400).json({ error: "Select project OR enter custom task" });
  }

  const today = new Date().toISOString().slice(0, 10);

  const created = await ManualRemark.create({
    user: req.user._id,
    text: text.trim(),
    requestedMinutes: Number(requestedMinutes),
    project: project || null,
    taskType: taskType || "Alpha",
    customTask: customTask || null,
    status: "pending",
    date: today,
  });

  // ✅ RETURN POPULATED RECORD
  const remark = await ManualRemark.findById(created._id)
    .populate("project", "name")
    .lean();

  res.json(remark);
});



// Update remark
router.put("/:id", requireAuth, async (req, res) => {
  const { text } = req.body;

  const updated = await ManualRemark.findOneAndUpdate(
    {
      _id: req.params.id,
      user: req.user._id,
      status: "pending", // 🔒 ADD THIS LINE
    },
    { text: text.trim() },
    { new: true }
  );

  if (!updated) {
    return res
      .status(400)
      .json({ error: "Cannot edit after approval/rejection" });
  }

  res.json(updated);
});

// Delete remark
router.delete("/:id", requireAuth, async (req, res) => {
  const deleted = await ManualRemark.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
    status: "pending", // 🔒 ADD THIS LINE
  });

  if (!deleted) {
    return res
      .status(400)
      .json({ error: "Cannot delete after approval/rejection" });
  }

  res.json({ success: true });
});


/* =====================================================
   ADMIN ROUTE (ALL USERS)
   ===================================================== */
router.get("/admin", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  const { user, from, to, status } = req.query;
  const query = {};

  // filter by status ONLY if provided
  if (status) {
    query.status = status;
  }

  // filter by user
  if (user && mongoose.Types.ObjectId.isValid(user)) {
    query.user = user;
  }

  // filter by date range
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = from;
    if (to) query.date.$lte = to;
  }

  const remarks = await ManualRemark.find(query)
    .populate("user", "name email")
    .populate("project", "name") 
    .sort({ createdAt: -1 })
    .lean();

  res.json(
    remarks.map((r) => ({
      _id: r._id,
      userId: r.user?._id,
      userName: r.user?.name,
      userEmail: r.user?.email,
      text: r.text,
      requestedMinutes: r.requestedMinutes,
      status: r.status,
      date: r.date,
      createdAt: r.createdAt,
       projectId: r.project?._id || null,
    projectName: r.project?.name || null,
    taskType: r.taskType || null,
    customTask: r.customTask || null,
    }))
  );
});

// UPDATE requested minutes (ADMIN – before approval)
router.put(
  "/:id/update-minutes",
  requireAuth,
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { requestedMinutes } = req.body;

    if (!requestedMinutes || requestedMinutes <= 0) {
      return res.status(400).json({ error: "Invalid minutes" });
    }

    const remark = await ManualRemark.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "pending", // 🔒 ONLY before approval
      },
      {
        requestedMinutes: Number(requestedMinutes),
      },
      { new: true }
    );

    if (!remark) {
      return res
        .status(400)
        .json({ error: "Cannot edit after approval/rejection" });
    }

    res.json(remark);
  }
);


// APPROVE manual time request
router.post("/:id/approve", requireAuth, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const remark = await ManualRemark.findOneAndUpdate(
    { _id: req.params.id, status: "pending" },
    { status: "approved", reviewedBy: req.user._id, reviewedAt: new Date() },
    { new: true }
  );

  if (!remark) {
    return res.status(404).json({ error: "Invalid request" });
  }

  let session;

  // =========================
  // PROJECT SESSION
  // =========================
  if (remark.project) {
    session = await WorkSession.findOne({
      user: remark.user,
      date: remark.date,
      project: remark.project,
    });

    if (!session) {
      session = await WorkSession.create({
        user: remark.user,
        date: remark.date,
        project: remark.project,
        taskType: remark.taskType,
        status: "stopped",
        accumulatedMinutes: 0,
        segments: [],
      });
    }
  }

  // =========================
  // GENERAL SESSION
  // =========================
  else {
    session = await WorkSession.findOne({
      user: remark.user,
      date: remark.date,
      project: null,
      customTask: remark.customTask,
    });

    if (!session) {
      session = await WorkSession.create({
        user: remark.user,
        date: remark.date,
        customTask: remark.customTask,
        taskType: remark.taskType,
        status: "stopped",
        accumulatedMinutes: 0,
        segments: [],
      });
    }
  }

  // =========================
  // ADD TIME
  // =========================
  session.accumulatedMinutes += remark.requestedMinutes;

  const lastSegment = session.segments[session.segments.length - 1];

  const start = lastSegment
    ? new Date(lastSegment.end)
    : new Date(`${remark.date}T09:00:00`);

  const end = new Date(start.getTime() + remark.requestedMinutes * 60000);

  session.segments.push({
    start,
    end,
    manual: true,
    source: "manual-remark",
    remarkId: remark._id,
    remarkText: remark.text,
  });

  await session.save();

  res.json({ success: true });
});




router.post(
  "/:id/reject",
  requireAuth,
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    await ManualRemark.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    });

    res.json({ success: true });
  }
);

// ===============================
// ADMIN – UPDATE REQUESTED MINUTES
// ===============================


export default router;
