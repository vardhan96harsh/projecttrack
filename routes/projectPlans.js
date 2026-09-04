// backend/routes/projectPlans.js
import express from "express";
import mongoose from "mongoose";
import ProjectPlan from "../models/ProjectPlan.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ─────────────────────────────────────────────
// GET /api/project-plans
// List all saved project plans with project details
// ─────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const plans = await ProjectPlan.find()
      .populate({
        path: "project",
        select: "name code company category status description",
        populate: [
          { path: "company", select: "name" },
          { path: "category", select: "name" },
        ],
      })
      .sort({ updatedAt: -1 })
      .lean();

    const validPlans = plans.filter(p => p.project != null);

    // Sync live task statuses so progress is 100% accurate (Batched to eliminate N+1 latency)
    const projectIds = validPlans
      .map((p) => p.project?._id)
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

    if (projectIds.length > 0) {
      try {
        const allTasks = await Task.find({ project: { $in: projectIds } })
          .select("project title status")
          .lean();

        if (allTasks.length > 0) {
          const tasksByProject = new Map();
          for (const t of allTasks) {
            const pId = t.project?.toString();
            if (!pId) continue;
            if (!tasksByProject.has(pId)) tasksByProject.set(pId, new Map());
            if (t.title) {
              tasksByProject.get(pId).set(t.title.trim().toLowerCase(), t);
            }
          }

          for (const p of validPlans) {
            if (!p.project?._id || !Array.isArray(p.phases)) continue;
            const taskMap = tasksByProject.get(p.project._id.toString());
            if (!taskMap) continue;

            for (const ph of p.phases) {
              for (const pt of ph.tasks || []) {
                const match = pt.title ? taskMap.get(pt.title.trim().toLowerCase()) : null;
                if (match) {
                  if (match.status === "completed") pt.status = "completed";
                  else if (match.status === "in_progress") pt.status = "in_progress";
                }
              }
            }
          }
        }
      } catch (syncErr) {
        console.warn("Sync task status error in list plans:", syncErr);
      }
    }

    res.json(validPlans);
  } catch (err) {
    console.error("GET ALL PROJECT PLANS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch project plans" });
  }
});

// ─────────────────────────────────────────────
// GET /api/project-plans/:projectId
// Get plan for a project
// ─────────────────────────────────────────────
router.get("/:projectId", requireAuth, async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Invalid projectId" });
    }

    const plan = await ProjectPlan.findOne({ project: projectId })
      .populate("phases.tasks.assignedTo", "name email designation")
      .populate("phases.tasks.subtasks.assignedTo", "name email designation");

    if (!plan) {
      return res.json({ project: projectId, phases: [], settings: {} });
    }

    // Sync live task status from Task collection
    const currentTasks = await Task.find({ project: projectId }).lean();
    if (currentTasks.length > 0 && Array.isArray(plan.phases)) {
      const taskMap = new Map();
      for (const ct of currentTasks) {
        if (ct.title) taskMap.set(ct.title.trim().toLowerCase(), ct);
      }

      const planObj = plan.toObject();
      for (const ph of planObj.phases || []) {
        for (const pt of ph.tasks || []) {
          const match = pt.title ? taskMap.get(pt.title.trim().toLowerCase()) : null;
          if (match) {
            if (match.status === "completed") pt.status = "completed";
            else if (match.status === "in_progress") pt.status = "in_progress";
          }
        }
      }
      return res.json(planObj);
    }

    res.json(plan);
  } catch (err) {
    console.error("GET PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to fetch project plan" });
  }
});

// ─────────────────────────────────────────────
// POST /api/project-plans/:projectId
// Save or update plan for a project (Admin only)
// ─────────────────────────────────────────────
router.post("/:projectId", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { settings, phases } = req.body;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Invalid projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const plan = await ProjectPlan.findOneAndUpdate(
      { project: projectId },
      {
        project: projectId,
        settings: settings || {},
        phases: phases || [],
        updatedBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true }
    )
      .populate("phases.tasks.assignedTo", "name email designation")
      .populate("phases.tasks.subtasks.assignedTo", "name email designation");

    res.json(plan);
  } catch (err) {
    console.error("SAVE PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to save project plan" });
  }
});

// ─────────────────────────────────────────────
// POST /api/project-plans/:projectId/sync-tasks
// Sync all plan tasks to the main Task collection
// so employees can pick them in their WorkTimer
// ─────────────────────────────────────────────
router.post("/:projectId/sync-tasks", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Invalid projectId" });
    }

    const plan = await ProjectPlan.findOne({ project: projectId });
    if (!plan || !plan.phases) {
      return res.status(400).json({ error: "No plan found to sync" });
    }

    // Role to WorkSession TaskType mapping
    const mapRoleToTaskType = (role) => {
      const r = (role || "").toUpperCase();
      if (r.includes("STORYBOARD") || r.includes("ID") || r.includes("INSTRUCTION")) return "Analysis";
      if (r.includes("QA") || r.includes("TEST")) return "Output QA";
      if (r.includes("ANIM") || r.includes("MOTION")) return "Alpha";
      if (r.includes("DEV") || r.includes("AUTHOR")) return "Alpha";
      return "Alpha";
    };

    let createdCount = 0;
    let updatedCount = 0;

    for (const phase of plan.phases) {
      for (const t of phase.tasks || []) {
        if (!t.title) continue;

        let assignedIds = [];
        if (Array.isArray(t.assignedTo)) {
          assignedIds = t.assignedTo
            .map((u) => (typeof u === "object" && u ? u._id : u))
            .filter((id) => mongoose.Types.ObjectId.isValid(id));
        } else if (t.assignedTo) {
          const rawId = typeof t.assignedTo === "object" ? t.assignedTo._id : t.assignedTo;
          if (mongoose.Types.ObjectId.isValid(rawId)) {
            assignedIds = [rawId];
          }
        }

        const existing = await Task.findOne({
          project: projectId,
          title: t.title.trim(),
        });

        const validDueDate =
          t.endDate && !isNaN(new Date(t.endDate).getTime()) ? new Date(t.endDate) : null;

        const taskData = {
          project: projectId,
          title: t.title.trim(),
          taskType: mapRoleToTaskType(t.role),
          assignedTo: assignedIds,
          estimatedMinutes: Math.round((Number(t.estimatedHours) || 0) * 60),
          dueDate: validDueDate,
          status:
            t.status === "completed"
              ? "completed"
              : t.status === "in_progress"
              ? "in_progress"
              : "open",
          description: `Phase: ${phase.name || "General"} | Deliverable: ${t.deliverable || "N/A"}`,
          createdBy: req.user._id,
        };

        if (existing) {
          await Task.findByIdAndUpdate(existing._id, taskData);
          updatedCount++;
        } else {
          await Task.create(taskData);
          createdCount++;
        }
      }
    }

    res.json({ ok: true, createdCount, updatedCount });
  } catch (err) {
    console.error("SYNC TASKS ERROR:", err);
    res.status(500).json({ error: "Failed to sync tasks" });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/project-plans/:projectId
// Delete a project plan (Admin only)
// ─────────────────────────────────────────────
router.delete("/:projectId", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Invalid projectId" });
    }

    const deletedPlan = await ProjectPlan.findOneAndDelete({ project: projectId });

    // Clean up non-completed tasks belonging to this plan (preserving completed records)
    await Task.deleteMany({ project: projectId, status: { $ne: "completed" } });

    res.json({ ok: true, message: "Project plan deleted successfully" });
  } catch (err) {
    console.error("DELETE PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to delete project plan" });
  }
});

export default router;
