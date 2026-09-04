// backend/routes/tasks.js
import express from "express";
import mongoose from "mongoose";
import Task from "../models/Task.js";
import Project from "../models/Project.js";
import ProjectPlan from "../models/ProjectPlan.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ─────────────────────────────────────────────
// GET /api/tasks/my
// Employee: get all tasks assigned to me
// Optional: ?projectId=, ?status=, ?includeCompleted=true
// ─────────────────────────────────────────────
router.get("/my", requireAuth, async (req, res) => {
  try {
    const filter = {
      assignedTo: req.user._id,
    };

    if (req.query.status) {
      filter.status = req.query.status;
    } else if (req.query.includeCompleted !== "true") {
      filter.status = { $ne: "completed" };
    }

    if (req.query.projectId && mongoose.Types.ObjectId.isValid(req.query.projectId)) {
      filter.project = req.query.projectId;
    }

    const tasks = await Task.find(filter)
      .populate({
        path: "project",
        select: "name code company category",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .sort({ createdAt: -1 });

    const validTasks = tasks.filter((t) => t.project != null);
    res.json(validTasks);
  } catch (err) {
    console.error("TASKS/MY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch your tasks" });
  }
});

// ─────────────────────────────────────────────
// GET /api/tasks/my/count
// Employee: get count of assigned incomplete tasks
// ─────────────────────────────────────────────
router.get("/my/count", requireAuth, async (req, res) => {
  try {
    const count = await Task.countDocuments({
      assignedTo: req.user._id,
      status: { $ne: "completed" },
    });
    res.json({ count });
  } catch (err) {
    console.error("TASKS/MY/COUNT ERROR:", err);
    res.status(500).json({ error: "Failed to get task count", count: 0 });
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
    const isAssigned = task.assignedTo.some(
      (id) => id.toString() === req.user._id.toString()
    );
    if (req.user.role !== "admin" && !isAssigned) {
      return res.status(403).json({ error: "Not authorized to update this task" });
    }

    task.status = status;
    await task.save();

    // Also sync the status back to the ProjectPlan document if one exists
    try {
      if (task.project) {
        const plan = await ProjectPlan.findOne({ project: task.project });
        if (plan && Array.isArray(plan.phases)) {
          let planModified = false;
          const planStatus = status === "completed" ? "completed" : status === "in_progress" ? "in_progress" : status;
          for (const ph of plan.phases) {
            for (const pt of ph.tasks || []) {
              if (pt.title && pt.title.trim().toLowerCase() === task.title.trim().toLowerCase()) {
                pt.status = planStatus;
                planModified = true;
              }
            }
          }
          if (planModified) {
            await plan.save();
          }
        }
      }
    } catch (planSyncErr) {
      console.warn("Could not sync task status to ProjectPlan:", planSyncErr);
    }

    const populated = await Task.findById(task._id)
      .populate("project", "name code")
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
// Required: ?projectId=
// Optional: ?userId= to filter by assigned user
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

    // Make sure project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Validate assignedTo ids
    const validAssignees = Array.isArray(assignedTo)
      ? assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];

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

    const validAssignees = Array.isArray(assignedTo)
      ? assignedTo.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];

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
