// backend/models/Task.js
import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    // Mirrors WorkSession.taskType so employees can pre-fill
    taskType: {
      type: String,
      enum: ["Alpha", "Beta", "CR", "Rework", "poc", "Analysis", "Storyboard QA", "Output QA"],
      default: "Alpha",
    },

    // Employees assigned to this task
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    estimatedMinutes: {
      type: Number,
      default: null, // optional — pulled from Project Plan Tool estimation
    },

    dueDate: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["open", "in_progress", "completed", "not_started", "review", "blocked", "on_hold"],
      default: "open",
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Index to quickly fetch tasks by project
taskSchema.index({ project: 1, status: 1 });
// Index to quickly fetch tasks assigned to a user
taskSchema.index({ assignedTo: 1, status: 1 });

export default mongoose.model("Task", taskSchema);
