import express from "express";
import ManualRemark from "../models/ManualRemark.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET all remarks of current user
router.get("/", requireAuth, async (req, res) => {
  const list = await ManualRemark.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  res.json(list);
});

// CREATE remark
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

// UPDATE remark
router.put("/:id", requireAuth, async (req, res) => {
  const { text } = req.body;

  const updated = await ManualRemark.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { text: text.trim() },
    { new: true }
  );

  res.json(updated);
});

// DELETE remark
router.delete("/:id", requireAuth, async (req, res) => {
  await ManualRemark.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });

  res.json({ success: true });
});

export default router;
