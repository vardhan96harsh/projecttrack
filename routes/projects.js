import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { company, category } = req.query;

    const q = {};
    if (company) q.company = company;
    if (category) q.category = category;

    const items = await Project.find(q)
      .populate("company")
      .populate("category")
      .sort({ createdAt: -1 });

    res.json(items);
  } catch (err) {
    console.error("PROJECT LIST ERROR:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, company, category, description, code, status } = req.body;

    if (!name?.trim() || !company || !category) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const created = await Project.create({
      name: name.trim(),
      company,
      category,
      description: description?.trim() || "",
      code: code?.trim() || "",
      status: status || "active",
    });

    const fullProject = await Project.findById(created._id)
      .populate("company")
      .populate("category");

    res.status(201).json(fullProject);
  } catch (err) {
    console.error("PROJECT CREATE ERROR:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        error: "Project already exists for this company and category",
      });
    }

    res.status(500).json({ error: "Create failed" });
  }
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, company, category, description, code, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid project id" });
    }

    if (!name?.trim() || !company || !category) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const updated = await Project.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        company,
        category,
        description: description?.trim() || "",
        code: code?.trim() || "",
        status: status || "active",
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("company")
      .populate("category");

    if (!updated) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error("PROJECT UPDATE ERROR:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        error: "Project already exists for this company and category",
      });
    }

    res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid project id" });
    }

    const deleted = await Project.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("PROJECT DELETE ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;