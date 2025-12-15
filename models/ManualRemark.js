import mongoose from "mongoose";

const manualRemarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
  },
  { timestamps: true }
);

export default mongoose.model("ManualRemark", manualRemarkSchema);
