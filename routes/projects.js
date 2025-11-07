
import express from "express";
import Project from "../models/Project.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { company, category } = req.query;
  const q = {};
  if (company) q.company = company;
  if (category) q.category = category;
  const items = await Project.find(q).populate("company").populate("category").sort({ createdAt: -1 });
  res.json(items);
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, company, category } = req.body;
  if (!name || !company || !category) return res.status(400).json({ error: "Missing fields" });
  const created = await Project.create({ name: name.trim(), company, category });
  res.status(201).json(created);
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, company, category } = req.body;
  const updated = await Project.findByIdAndUpdate(req.params.id, { name, company, category }, { new: true });
  res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  await Project.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
