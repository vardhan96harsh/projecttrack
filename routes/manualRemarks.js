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
    .sort({ createdAt: -1 })
    .lean();

  res.json(list);
});

// Create remark
// Create remark + time request
router.post("/", requireAuth, async (req, res) => {
  const { text, requestedMinutes } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Remark text cannot be empty" });
  }

  if (!requestedMinutes || requestedMinutes <= 0) {
    return res.status(400).json({ error: "Requested time is required" });
  }

  const today = new Date().toISOString().slice(0, 10);

  const remark = await ManualRemark.create({
    user: req.user._id,
    text: text.trim(),
    requestedMinutes: Number(requestedMinutes),
    status: "pending",
    date: today,
  });

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
router.post(
  "/:id/approve",
  requireAuth,
  async (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const remark = await ManualRemark.findById(req.params.id);
    if (!remark || remark.status !== "pending") {
      return res.status(404).json({ error: "Invalid request" });
    }

    // find stopped session for that date
    let session = await WorkSession.findOne({
      user: remark.user,
      date: remark.date,
      status: "stopped",
    });

    if (!session) {
      session = await WorkSession.create({
        user: remark.user,
        date: remark.date,
        status: "stopped",
        accumulatedMinutes: 0,
        segments: [],
      });
    }

    // ✅ ADD TIME
    session.accumulatedMinutes += remark.requestedMinutes;

  const start = new Date(`${remark.date}T00:00:00`);
const end = new Date(start.getTime() + remark.requestedMinutes * 60 * 1000);

session.segments.push({
  start,
  end,
  manual: true,
  source: "manual-remark",
  remarkText: remark.text,      // 👈 THIS IS KEY
  remarkId: remark._id,
  addedBy: "admin",
});


    await session.save();

    // mark remark approved
    remark.status = "approved";
    remark.reviewedBy = req.user._id;
    remark.reviewedAt = new Date();
    await remark.save();

    res.json({ success: true });
  }
);


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
        status: "pending",
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

export default router;
