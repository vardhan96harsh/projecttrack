// backend/models/WorkSession.js
import mongoose from "mongoose";

const segmentSchema = new mongoose.Schema({ start: Date, end: Date });

const workSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    date: String, // YYYY-MM-DD
    status: { type: String, enum: ["active", "paused", "stopped"], default: "active" },
    segments: [segmentSchema],
    accumulatedMinutes: { type: Number, default: 0 }, // float minutes
    currentStart: Date,
    remarks: String,

    // ⬇️ NEW
    machineId: String,
    machineInfo: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

workSessionSchema.methods.totalMinutesNow = function () {
  let total = this.accumulatedMinutes || 0;
  if (this.status === "active" && this.currentStart) {
    total += (Date.now() - new Date(this.currentStart)) / 60000;
  }
  return Math.round(total * 100) / 100;
};

export default mongoose.model("WorkSession", workSessionSchema);
