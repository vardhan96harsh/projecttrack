import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import Company from "../models/Company.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

function getCompanyPrefix(companyName) {
  if (!companyName || typeof companyName !== "string") return "PRJ";

  const clean = companyName.trim().replace(/[^a-zA-Z0-9\s]/g, "");
  if (!clean) return "PRJ";

  const stopWords = new Set([
    "pvt", "ltd", "inc", "corp", "corporation", "llc", "co", "company", "limited", "private"
  ]);
  const allWords = clean.split(/\s+/).filter(Boolean);
  const significantWords = allWords.filter((w) => !stopWords.has(w.toLowerCase()));
  const targetWords = significantWords.length > 0 ? significantWords : allWords;

  if (targetWords.length === 1) {
    return targetWords[0].slice(0, 4).toUpperCase();
  }

  if (targetWords.length >= 2) {
    const initials = targetWords.map((w) => w[0]).join("").toUpperCase();
    if (initials.length >= 2 && initials.length <= 4) {
      return initials;
    }
    return initials.slice(0, 4);
  }

  return clean.slice(0, 4).toUpperCase() || "PRJ";
}

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
      .collation({ locale: "en", strength: 2 })
      .sort({ name: 1 });

    res.json(items);
  } catch (err) {
    console.error("PROJECT LIST ERROR:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, company, category, description, code, status, date } = req.body;

    if (!name?.trim() || !company || !category) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Auto-generate project code on basis of company name if not supplied
    let finalCode = code?.trim();
    if (!finalCode) {
      let companyName = "";
      if (company) {
        const comp = await Company.findById(company).select("name");
        companyName = comp?.name || "";
      }
      const prefix = getCompanyPrefix(companyName);
      const regex = new RegExp(`^${prefix}-(\\d+)`, "i");

      const existingProjects = await Project.find({ code: { $regex: regex } }).select("code");
      let maxNum = 0;
      for (const p of existingProjects) {
        const m = (p.code || "").match(regex);
        if (m && m[1]) {
          const val = parseInt(m[1], 10);
          if (val > maxNum) maxNum = val;
        }
      }
      finalCode = `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
    }

    // Ensure default date is today's date if not provided
    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const finalDate = date?.trim() || todayStr;

    const created = await Project.create({
      name: name.trim(),
      company,
      category,
      description: description?.trim() || "",
      code: finalCode,
      date: finalDate,
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
    const { name, company, category, description, code, status, date } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid project id" });
    }

    if (!name?.trim() || !company || !category) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const updateDoc = {
      name: name.trim(),
      company,
      category,
      description: description?.trim() || "",
      code: code?.trim() || "",
      status: status || "active",
    };

    if (date !== undefined) {
      updateDoc.date = date?.trim() || "";
    }

    const updated = await Project.findByIdAndUpdate(
      req.params.id,
      updateDoc,
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