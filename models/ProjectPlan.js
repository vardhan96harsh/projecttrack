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
    settings: {
      projectType: { type: String, default: "storyline-360" },
      complexity: { type: String, default: "Medium" },
      courseLengthMinutes: { type: Number, default: 60 },
      moduleCount: { type: Number, default: 4 },
      startDate: { type: String, default: () => new Date().toISOString().slice(0, 10) },
      hoursPerDay: { type: Number, default: 7 },
    },
    phases: [
      {
        id: String,
        name: String,
        code: String,
        color: String,
        expanded: { type: Boolean, default: true },
        tasks: [
          {
            id: String,
            title: String,
            role: String,
            assignedTo: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
              },
            ],
            estimatedHours: { type: Number, default: 0 },
            startDate: String,
            endDate: String,
            durationDays: { type: Number, default: 1 },
            dependencies: [String],
            status: {
              type: String,
              enum: ["not_started", "in_progress", "review", "completed"],
              default: "not_started",
            },
            isMilestone: { type: Boolean, default: false },
            deliverable: String,
            subtasks: [
              {
                id: String,
                title: String,
                completed: { type: Boolean, default: false },
                assignedTo: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: "User",
                },
              },
            ],
          },
        ],
      },
    ],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ProjectPlan", projectPlanSchema);
