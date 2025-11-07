
import express from "express";
import Timesheet from "../models/Timesheet.js";
import Company from "../models/Company.js";
import Category from "../models/Category.js";
import Project from "../models/Project.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Create
router.post("/", requireAuth, async (req, res) => {
  const { company, category, project, taskType, hours, remarks, dateLogged } = req.body;
  if (!company || !category || !project || !taskType || !hours || !dateLogged) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const created = await Timesheet.create({
    user: req.user.id,
    company, category, project, taskType, hours, remarks,
    dateLogged: new Date(dateLogged)
  });
  res.status(201).json(created);
});

// List (with filters). Admin sees all; employee sees own
router.get("/", requireAuth, async (req, res) => {
  const { company, category, project, user, from, to, taskType } = req.query;
  const q = {};
  if (req.user.role !== "admin") q.user = req.user.id;
  if (user && req.user.role === "admin") q.user = user;
  if (company) q.company = company;
  if (category) q.category = category;
  if (project) q.project = project;
  if (taskType) q.taskType = taskType;
  if (from || to) {
    q.dateLogged = {};
    if (from) q.dateLogged.$gte = new Date(from);
    if (to) q.dateLogged.$lte = new Date(to);
  }
  const items = await Timesheet.find(q)
    .populate("user", "name email role")
    .populate("company", "name")
    .populate("category", "name")
    .populate("project", "name")
    .sort({ dateLogged: -1, createdAt: -1 });
  res.json(items);
});

export default router;
