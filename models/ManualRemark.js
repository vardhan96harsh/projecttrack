import mongoose from "mongoose";

const manualRemarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: { type: String, required: true },

    requestedMinutes: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: Date,

    date: { type: String, required: true },

    // 🔹 PROJECT CONTEXT
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },

    // 🔹 NEW: work type like WorkTimer
    taskType: {
      type: String,
      enum: [
        "Alpha",
        "Beta",
        "CR",
        "Rework",
        "poc",
        "Analysis",
        "Storyboard QA",
        "Output QA",
      ],
      default: "Alpha",
    },

    // 🔹 NEW: custom task (general request)
    customTask: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

manualRemarkSchema.index({ user: 1, date: 1 });

export default mongoose.model("ManualRemark", manualRemarkSchema);
