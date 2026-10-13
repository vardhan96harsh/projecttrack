// backend/models/ProjectPlan.js
import mongoose from "mongoose";

const projectPlanSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      unique: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
    },
    clientName: {
      type: String,
      trim: true,
      default: "",
    },
    projectType: {
      type: String,
      default: "storyline-360",
    },
    complexity: {
      type: String,
      default: "Level 2",
    },
    startPhaseId: {
      type: String,
      default: null,
    },
    startDate: {
      type: String,
      default: () => new Date().toISOString().slice(0, 10),
    },
    calculatedEndDate: {
      type: String,
      default: null,
    },
    courseLengthMinutes: {
      type: Number,
      default: 60,
    },
    moduleCount: {
      type: Number,
      default: 4,
    },
    parallelPipelining: {
      type: Boolean,
      default: true,
    },
    totalWorkingDays: {
      type: Number,
      default: 0,
    },
    totalCalendarDays: {
      type: Number,
      default: 0,
    },
    nonWorkingDays: {
      type: Number,
      default: 0,
    },
    estimatedEffortHours: {
      type: Number,
      default: 0,
    },
    allocatedEffortHours: {
      type: Number,
      default: 0,
    },
    actualUsedEffortHours: {
      type: Number,
      default: 0,
    },
    projectManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    assignedTeam: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        name: String,
        email: String,
        roleCategory: String, // PM, ID, DEVELOPER, ANIMATOR, DESIGNER, QA, VO
        designation: String,
        dailyHours: {
          type: Number,
          default: 7,
        },
      },
    ],
    phases: [
      {
        id: String,
        name: String,
        taskIds: [String],
      },
    ],
    tasks: [
      {
        id: String,
        name: String,
        phaseId: String,
        phaseName: String,
        role: String,
        roleCategory: String,
        assignedResource: mongoose.Schema.Types.Mixed,
        assignedResources: [mongoose.Schema.Types.Mixed],
        startDate: String,
        endDate: String,
        durationWorkingDays: {
          type: Number,
          default: 1,
        },
        hours: {
          type: Number,
          default: 0,
        },
        allocatedHours: {
          type: Number,
          default: 0,
        },
        actualUsedHours: {
          type: Number,
          default: 0,
        },
        dependencies: [String],
        status: {
          type: String,
          default: "Not Started",
        },
        isMilestone: {
          type: Boolean,
          default: false,
        },
        isClientTask: {
          type: Boolean,
          default: false,
        },
        isManualOverride: {
          type: Boolean,
          default: false,
        },
        criticalPath: {
          type: Boolean,
          default: false,
        },
        slack: {
          type: Number,
          default: 0,
        },
      },
    ],
    manualOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    complexityConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Indexes
projectPlanSchema.index({ company: 1 });
projectPlanSchema.index({ "assignedTeam.user": 1 });

export default mongoose.model("ProjectPlan", projectPlanSchema);
