// backend/routes/tasks.js
import express from "express";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import ProjectPlan from "../models/ProjectPlan.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Helper to sync task status to ProjectPlan and recalculate actual burned effort
async function syncStatusToProjectPlan(projectId, taskTitle, status) {
  if (!projectId || !taskTitle) return;
  try {
    const plan = await ProjectPlan.findOne({ project: projectId });
    if (plan && Array.isArray(plan.tasks)) {
      let planModified = false;
      const planStatus =
        status === "completed"
          ? "Completed"
          : status === "in_progress"
          ? "In Progress"
          : status === "blocked"
          ? "Blocked"
          : status === "on_hold"
          ? "On Hold"
          : status === "review"
          ? "Review"
          : "Not Started";

      plan.tasks.forEach((pt) => {
        if (pt.name && pt.name.trim().toLowerCase() === taskTitle.trim().toLowerCase()) {
          pt.status = planStatus;
          planModified = true;
        }
      });

      if (planModified) {
        const actualHours = Number(
          plan.tasks
            .filter((t) => t.status === "Completed")
            .reduce((sum, t) => sum + (t.actualUsedHours || t.hours || 0), 0)
            .toFixed(1)
        );
        plan.actualUsedEffortHours = actualHours;
        plan.markModified("tasks");
        await plan.save();
      }
    }
  } catch (err) {
    console.warn("Could not sync task status to ProjectPlan:", err.message);
  }
}

// ─────────────────────────────────────────────
// GET /api/tasks/my/count
// Return count of open / in_progress tasks for logged-in user
// ─────────────────────────────────────────────
router.get("/my/count", requireAuth, async (req, res) => {
  try {
    const count = await Task.countDocuments({
      assignedTo: req.user._id,
      status: { $in: ["open", "in_progress", "not_started"] },
    });
    res.json({ count });
  } catch (err) {
    console.error("GET MY TASKS COUNT ERROR:", err);
    res.status(500).json({ error: "Failed to fetch task count" });
  }
});

// ─────────────────────────────────────────────
// GET /api/tasks/my
// Return all tasks assigned to logged-in user
// ─────────────────────────────────────────────
router.get("/my", requireAuth, async (req, res) => {
  try {
    const tasks = await Task.find({ assignedTo: req.user._id })
      .populate({
        path: "project",
        select: "name code company category status",
        populate: [
          { path: "company", select: "name code" },
          { path: "category", select: "name" },
        ],
      })
      .populate("assignedTo", "name email designation")
      .populate("createdBy", "name")
      .sort({ dueDate: 1, createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    console.error("GET MY TASKS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch user tasks" });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/tasks/:id/status
// Employee (or Admin): update status of assigned task
// ─────────────────────────────────────────────
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["open", "in_progress", "completed", "not_started", "review", "blocked", "on_hold"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Check if user is admin or assigned to this task
    const isAssigned = (task.assignedTo || []).some(
      (id) => (id?._id || id)?.toString() === (req.user._id || req.user.id)?.toString()
    );
    if (req.user.role !== "admin" && !isAssigned) {
      return res.status(403).json({ error: "Not authorized to update this task" });
    }

    task.status = status;
    await task.save();

    // Sync status to ProjectPlan document if one exists and update actualUsedEffortHours
    if (task.project) {
      await syncStatusToProjectPlan(task.project, task.title, status);
    }

    const populated = await Task.findById(task._id)
      .populate({
        path: "project",
        select: "name code company category",
        populate: [
          { path: "company", select: "name code" },
          { path: "category", select: "name" },
        ],
      })
      .populate("assignedTo", "name email designation");

    res.json(populated);
  } catch (err) {
    console.error("TASK STATUS UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update task status" });
  }
});

// ─────────────────────────────────────────────
// GET /api/tasks
// Admin / any auth: list tasks for a project
// ─────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const { projectId, userId } = req.query;

    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Valid projectId is required" });
    }

    const filter = { project: projectId };

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      filter.assignedTo = userId;
    }

    const tasks = await Task.find(filter)
      .populate("assignedTo", "name email designation")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });

    res.json(tasks);
  } catch (err) {
    console.error("TASKS LIST ERROR:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// ─────────────────────────────────────────────
// POST /api/tasks
// Admin only: create a task under a project
// ─────────────────────────────────────────────
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      projectId,
      title,
      taskType,
      assignedTo,
      estimatedMinutes,
      dueDate,
      description,
    } = req.body;

    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Valid projectId is required" });
    }

    if (!title?.trim()) {
      return res.status(400).json({ error: "Task title is required" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    let validAssignees = Array.isArray(assignedTo)
      ? assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];
    if (validAssignees.length > 0) {
      const activeUsers = await User.find({ _id: { $in: validAssignees }, status: { $ne: "inactive" } }).select("_id");
      const activeSet = new Set(activeUsers.map((u) => u._id.toString()));
      validAssignees = validAssignees.filter((id) => activeSet.has(id.toString()));
    }

    const task = await Task.create({
      project: projectId,
      title: title.trim(),
      taskType: taskType || "Alpha",
      assignedTo: validAssignees,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      dueDate: dueDate || null,
      description: description?.trim() || "",
      createdBy: req.user._id,
    });

    const populated = await Task.findById(task._id)
      .populate("assignedTo", "name email designation")
      .populate("createdBy", "name");

    res.status(201).json(populated);
  } catch (err) {
    console.error("TASK CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

// ─────────────────────────────────────────────
// PUT /api/tasks/:id
// Admin only: update task
// ─────────────────────────────────────────────
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const {
      title,
      taskType,
      assignedTo,
      estimatedMinutes,
      dueDate,
      status,
      description,
    } = req.body;

    let validAssignees = Array.isArray(assignedTo)
      ? assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];
    if (validAssignees.length > 0) {
      const activeUsers = await User.find({ _id: { $in: validAssignees }, status: { $ne: "inactive" } }).select("_id");
      const activeSet = new Set(activeUsers.map((u) => u._id.toString()));
      validAssignees = validAssignees.filter((id) => activeSet.has(id.toString()));
    }

    const updated = await Task.findByIdAndUpdate(
      req.params.id,
      {
        ...(title?.trim() && { title: title.trim() }),
        ...(taskType && { taskType }),
        ...(assignedTo !== undefined && { assignedTo: validAssignees }),
        ...(estimatedMinutes !== undefined && {
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
        }),
        ...(dueDate !== undefined && { dueDate: dueDate || null }),
        ...(status && { status }),
        ...(description !== undefined && { description: description?.trim() || "" }),
      },
      { new: true, runValidators: true }
    )
      .populate("assignedTo", "name email designation")
      .populate("createdBy", "name");

    if (!updated) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (status && updated.project) {
      await syncStatusToProjectPlan(updated.project, updated.title, status);
    }

    res.json(updated);
  } catch (err) {
    console.error("TASK UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/tasks/:id
// Admin only: delete task
// ─────────────────────────────────────────────
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const deleted = await Task.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("TASK DELETE ERROR:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
