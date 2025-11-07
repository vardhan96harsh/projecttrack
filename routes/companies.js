
import express from "express";
import Company from "../models/Company.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = await Company.find().sort({ name: 1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name required" });
  const created = await Company.create({ name: name.trim() });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name } = req.body;
  const updated = await Company.findByIdAndUpdate(req.params.id, { name }, { new: true });
  res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await Company.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
