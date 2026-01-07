import mongoose from "mongoose";
const manualRemarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: { type: String, required: true },

    // ⏱️ Requested time
    requestedMinutes: {
      type: Number,
      required: true, // total minutes (hours * 60 + minutes)
    },

    // ✅ Approval workflow
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // Admin info
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: Date,

    date: { type: String, required: true }, // YYYY-MM-DD
  },
  { timestamps: true }
);


export default mongoose.model("ManualRemark", manualRemarkSchema);
