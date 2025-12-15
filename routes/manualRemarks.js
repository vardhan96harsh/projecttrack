import express from "express";
import mongoose from "mongoose";
import ManualRemark from "../models/ManualRemark.js";
import { requireAuth } from "../middleware/auth.js";

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
router.post("/", requireAuth, async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Remark text cannot be empty" });
  }

  const today = new Date().toISOString().slice(0, 10);

  const remark = await ManualRemark.create({
    user: req.user._id,
    text: text.trim(),
    date: today,
  });

  res.json(remark);
});

// Update remark
router.put("/:id", requireAuth, async (req, res) => {
  const { text } = req.body;

  const updated = await ManualRemark.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { text: text.trim() },
    { new: true }
  );

  res.json(updated);
});

// Delete remark
router.delete("/:id", requireAuth, async (req, res) => {
  await ManualRemark.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });

  res.json({ success: true });
});

/* =====================================================
   ADMIN ROUTE (ALL USERS)
   ===================================================== */

router.get("/admin", requireAuth, async (req, res) => {
  try {
    // Admin-only
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const { user, from, to } = req.query;
    const query = {};

    // ✅ SAFELY APPLY USER FILTER
    if (user && mongoose.Types.ObjectId.isValid(user)) {
      query.user = user;
    }

    // Date range filter
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }

    const remarks = await ManualRemark.find(query)
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const formatted = remarks.map((r) => ({
      _id: r._id,
      userId: r.user?._id,
      userName: r.user?.name,
      userEmail: r.user?.email,
      text: r.text,
      date: r.date,
      createdAt: r.createdAt,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("ADMIN manual remarks error:", err);
    res.status(500).json({ error: "Failed to fetch manual remarks" });
  }
});

export default router;
