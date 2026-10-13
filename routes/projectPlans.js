// backend/routes/projectPlans.js
import express from "express";
import mongoose from "mongoose";
import ProjectPlan from "../models/ProjectPlan.js";
import Project from "../models/Project.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import ComplexityConfig from "../models/ComplexityConfig.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Helper to map role to WorkSession taskType
function mapRoleToTaskType(role) {
  const r = (role || "").toUpperCase();
  if (r.includes("STORYBOARD") || r.includes("ID") || r.includes("INSTRUCTION")) return "Analysis";
  if (r.includes("QA") || r.includes("TEST")) return "Output QA";
  if (r.includes("ANIM") || r.includes("MOTION")) return "Alpha";
  if (r.includes("DEV") || r.includes("AUTHOR")) return "Alpha";
  return "Alpha";
}

// Helper to sync tasks to Task collection
async function syncPlanTasksToTaskCollection(plan, userId) {
  if (!plan || !plan.project || !Array.isArray(plan.tasks)) return { createdCount: 0, updatedCount: 0 };

  const projectId = plan.project._id || plan.project;
  let createdCount = 0;
  let updatedCount = 0;

  for (const t of plan.tasks) {
    if (!t.name || t.isClientTask) continue;

    // Collect assigned user IDs
    let assignedIds = [];
    if (Array.isArray(t.assignedResources) && t.assignedResources.length > 0) {
      assignedIds = t.assignedResources
        .map((u) => (typeof u === "object" && u ? (u.user || u._id || u.id) : u))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    } else if (t.assignedResource && Array.isArray(t.assignedResource.members) && t.assignedResource.members.length > 0) {
      assignedIds = t.assignedResource.members
        .map((u) => (typeof u === "object" && u ? (u.user || u._id || u.id) : u))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    } else if (t.assignedResource) {
      const rawId = typeof t.assignedResource === "object" ? (t.assignedResource.user || t.assignedResource._id || t.assignedResource.id) : t.assignedResource;
      if (mongoose.Types.ObjectId.isValid(rawId)) {
        assignedIds = [rawId];
      }
    } else if (t.assignedUser || t.userId) {
      const rawId = typeof (t.assignedUser || t.userId) === "object" ? ((t.assignedUser || t.userId).user || (t.assignedUser || t.userId)._id || (t.assignedUser || t.userId).id) : (t.assignedUser || t.userId);
      if (mongoose.Types.ObjectId.isValid(rawId)) {
        assignedIds = [rawId];
      }
    }

    // Fallback: If no direct resource assigned on task, check assignedTeam matching the role
    if (assignedIds.length === 0 && Array.isArray(plan.assignedTeam)) {
      const matchingTeam = plan.assignedTeam.filter(
        (tm) => tm.roleCategory && t.roleCategory && tm.roleCategory.toUpperCase() === t.roleCategory.toUpperCase()
      );
      assignedIds = matchingTeam
        .map((tm) => {
          const u = tm.user;
          return typeof u === "object" && u ? (u._id || u.id) : u;
        })
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    }

    // Exclude any inactive users from assignment
    if (assignedIds.length > 0) {
      const activeUserDocs = await User.find({
        _id: { $in: assignedIds },
        status: { $ne: "inactive" },
      }).select("_id");
      const activeSet = new Set(activeUserDocs.map((u) => u._id.toString()));
      assignedIds = assignedIds.filter((id) => activeSet.has(id.toString()));
    }

    const validDueDate = t.endDate && !isNaN(new Date(t.endDate).getTime()) ? new Date(t.endDate) : null;

    const taskStatus =
      t.status === "Completed"
        ? "completed"
        : t.status === "In Progress"
        ? "in_progress"
        : "open";


    const existing = await Task.findOne({
      project: projectId,
      title: t.name.trim(),
    });

    // Do not revert completed or in_progress task to open if employee already worked on it
    let effectiveStatus = taskStatus;
    if (existing && existing.status && existing.status !== "open" && taskStatus === "open") {
      effectiveStatus = existing.status;
      t.status = existing.status === "completed" ? "Completed" : existing.status === "in_progress" ? "In Progress" : t.status;
    }

    const taskData = {
      project: projectId,
      title: t.name.trim(),
      taskType: mapRoleToTaskType(t.role || t.roleCategory),
      assignedTo: assignedIds,
      estimatedMinutes: Math.round((Number(t.hours) || 0) * 60),
      dueDate: validDueDate,
      status: effectiveStatus,
      description: `Phase: ${t.phaseName || "General"} | Role: ${t.role || t.roleCategory || "Specialist"} | Days: ${t.durationWorkingDays || 1}`,
      createdBy: userId,
    };

    if (existing) {
      await Task.findByIdAndUpdate(existing._id, taskData);
      updatedCount++;
    } else {
      await Task.create(taskData);
      createdCount++;
    }
  }

  return { createdCount, updatedCount };
}

// ─────────────────────────────────────────────
// GET /api/project-plans/config/complexity
// Get global complexity rules
// ─────────────────────────────────────────────
router.get("/config/complexity", requireAuth, async (_req, res) => {
  try {
    const doc = await ComplexityConfig.findOne({ key: "default" });
    res.json({ ok: true, config: doc?.config || null });
  } catch (err) {
    console.error("GET COMPLEXITY CONFIG ERROR:", err);
    res.status(500).json({ error: "Failed to fetch complexity config" });
  }
});

// ─────────────────────────────────────────────
// PUT /api/project-plans/config/complexity
// Save global complexity rules (Admin only)
// ─────────────────────────────────────────────
router.put("/config/complexity", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ error: "Config payload is required" });
    }

    const doc = await ComplexityConfig.findOneAndUpdate(
      { key: "default" },
      { config, updatedBy: req.user._id },
      { new: true, upsert: true }
    );

    res.json({ ok: true, config: doc.config });
  } catch (err) {
    console.error("PUT COMPLEXITY CONFIG ERROR:", err);
    res.status(500).json({ error: "Failed to save complexity config" });
  }
});

// ─────────────────────────────────────────────
// GET /api/project-plans
// List all project plans
// ─────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const plans = await ProjectPlan.find()
      .populate("project", "name code status company category")
      .populate("company", "name code")
      .populate("projectManager", "name email designation status")
      .populate("assignedTeam.user", "name email designation status")
      .sort({ updatedAt: -1 })
      .lean();

    // Filter out orphaned plans if project was deleted, and filter out inactive squad members
    const validPlans = plans
      .filter((p) => p.project != null)
      .map((p) => {
        if (Array.isArray(p.assignedTeam)) {
          p.assignedTeam = p.assignedTeam.filter(
            (tm) => tm.user && tm.user.status !== "inactive"
          );
        }
        if (p.projectManager && p.projectManager.status === "inactive") {
          p.projectManager = null;
        }
        return p;
      });

    res.json(validPlans);
  } catch (err) {
    console.error("GET ALL PROJECT PLANS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch project plans" });
  }
});

// ─────────────────────────────────────────────
// GET /api/project-plans/:id
// Get plan by projectId or planId
// ─────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    let plan = await ProjectPlan.findOne({
      $or: [{ _id: id }, { project: id }],
    })
      .populate("project", "name code status company category")
      .populate("company", "name code")
      .populate("projectManager", "name email designation status")
      .populate("assignedTeam.user", "name email designation status")
      .lean();

    if (!plan) {
      return res.status(404).json({ error: "Project plan not found" });
    }

    // Filter out inactive members
    if (Array.isArray(plan.assignedTeam)) {
      plan.assignedTeam = plan.assignedTeam.filter(
        (tm) => tm.user && tm.user.status !== "inactive"
      );
    }
    if (plan.projectManager && plan.projectManager.status === "inactive") {
      plan.projectManager = null;
    }

    // Sync task live statuses from Task collection
    if (plan.project) {
      const tasks = await Task.find({ project: plan.project._id || plan.project }).lean();
      if (tasks.length > 0 && Array.isArray(plan.tasks)) {
        const taskMap = new Map();
        tasks.forEach((tk) => {
          if (tk.title) taskMap.set(tk.title.trim().toLowerCase(), tk);
        });

        plan.tasks = plan.tasks.map((pt) => {
          const match = pt.name ? taskMap.get(pt.name.trim().toLowerCase()) : null;
          if (match) {
            return {
              ...pt,
              status: match.status === "completed" ? "Completed" : match.status === "in_progress" ? "In Progress" : pt.status,
            };
          }
          return pt;
        });
      }
    }

    res.json(plan);
  } catch (err) {
    console.error("GET PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to fetch project plan" });
  }
});

// ─────────────────────────────────────────────
// POST /api/project-plans
// Save or create a project plan (Admin only)
// ─────────────────────────────────────────────
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      projectId,
      companyId,
      clientName,
      projectType,
      complexity,
      startPhaseId,
      startDate,
      calculatedEndDate,
      courseLengthMinutes,
      moduleCount,
      parallelPipelining,
      totalWorkingDays,
      totalCalendarDays,
      nonWorkingDays,
      estimatedEffortHours,
      allocatedEffortHours,
      actualUsedEffortHours,
      projectManager,
      assignedTeam,
      phases,
      tasks,
      manualOverrides,
      complexityConfig,
    } = req.body;

    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Valid projectId is required" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const effectiveCompanyId = companyId || project.company;

    // Filter out inactive users from assignedTeam and projectManager
    let filteredTeam = Array.isArray(assignedTeam) ? assignedTeam : [];
    if (filteredTeam.length > 0) {
      const teamUserIds = filteredTeam
        .map((tm) => (typeof tm.user === "object" && tm.user ? (tm.user._id || tm.user.id) : tm.user))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (teamUserIds.length > 0) {
        const activeUsers = await User.find({
          _id: { $in: teamUserIds },
          status: { $ne: "inactive" },
        }).select("_id");
        const activeSet = new Set(activeUsers.map((u) => u._id.toString()));
        filteredTeam = filteredTeam.filter((tm) => {
          const uId = typeof tm.user === "object" && tm.user ? (tm.user._id || tm.user.id) : tm.user;
          return uId ? activeSet.has(uId.toString()) : false;
        });
      }
    }

    let validPm = mongoose.Types.ObjectId.isValid(projectManager) ? projectManager : null;
    if (validPm) {
      const pmUser = await User.findOne({ _id: validPm, status: { $ne: "inactive" } });
      if (!pmUser) validPm = null;
    }

    const planData = {
      project: projectId,
      company: effectiveCompanyId,
      clientName: clientName || "",
      projectType: projectType || "storyline-360",
      complexity: complexity || "Level 2",
      startPhaseId: startPhaseId || null,
      startDate: startDate || new Date().toISOString().slice(0, 10),
      calculatedEndDate: calculatedEndDate || null,
      courseLengthMinutes: Number(courseLengthMinutes) || 60,
      moduleCount: Number(moduleCount) || 4,
      parallelPipelining: parallelPipelining !== undefined ? Boolean(parallelPipelining) : true,
      totalWorkingDays: Number(totalWorkingDays) || 0,
      totalCalendarDays: Number(totalCalendarDays) || 0,
      nonWorkingDays: Number(nonWorkingDays) || 0,
      estimatedEffortHours: Number(estimatedEffortHours) || 0,
      allocatedEffortHours: Number(allocatedEffortHours) || 0,
      actualUsedEffortHours:
        Number(actualUsedEffortHours) > 0
          ? Number(actualUsedEffortHours)
          : Number(
              (Array.isArray(tasks) ? tasks : [])
                .filter((t) => t.status === "Completed")
                .reduce((sum, t) => sum + (t.actualUsedHours || t.hours || 0), 0)
                .toFixed(1)
            ),
      projectManager: validPm,
      assignedTeam: filteredTeam,
      phases: Array.isArray(phases) ? phases : [],
      tasks: Array.isArray(tasks) ? tasks : [],
      manualOverrides: manualOverrides || {},
      complexityConfig: complexityConfig || null,
      updatedBy: req.user._id,
    };

    const savedPlan = await ProjectPlan.findOneAndUpdate(
      { project: projectId },
      planData,
      { new: true, upsert: true, runValidators: true }
    )
      .populate("project", "name code status company category")
      .populate("company", "name code")
      .populate("projectManager", "name email designation")
      .populate("assignedTeam.user", "name email designation");

    // Automatically sync plan tasks into Task collection for employee visibility
    try {
      await syncPlanTasksToTaskCollection(savedPlan, req.user._id);
    } catch (syncErr) {
      console.warn("Auto-sync tasks warning:", syncErr.message);
    }

    res.json(savedPlan);
  } catch (err) {
    console.error("SAVE PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to save project plan" });
  }
});

// ─────────────────────────────────────────────
// POST /api/project-plans/:id/sync-tasks
// Explicitly sync all plan tasks to the Task collection
// ─────────────────────────────────────────────
router.post("/:id/sync-tasks", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const plan = await ProjectPlan.findOne({
      $or: [{ _id: id }, { project: id }],
    });

    if (!plan) {
      return res.status(404).json({ error: "Project plan not found" });
    }

    const result = await syncPlanTasksToTaskCollection(plan, req.user._id);

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("SYNC TASKS ERROR:", err);
    res.status(500).json({ error: "Failed to sync tasks" });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/project-plans/:id
// Delete a project plan (Admin only)
// ─────────────────────────────────────────────
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const plan = await ProjectPlan.findOne({
      $or: [{ _id: id }, { project: id }],
    });

    if (!plan) {
      return res.status(404).json({ error: "Project plan not found" });
    }

    await ProjectPlan.findByIdAndDelete(plan._id);

    // Clean up non-completed tasks linked to this project
    if (plan.project) {
      await Task.deleteMany({
        project: plan.project,
        status: { $ne: "completed" },
      });
    }

    res.json({ ok: true, message: "Project plan deleted successfully" });
  } catch (err) {
    console.error("DELETE PROJECT PLAN ERROR:", err);
    res.status(500).json({ error: "Failed to delete project plan" });
  }
});

export default router;
