import mongoose from "mongoose";

const manualRemarkSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true },
  date: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("ManualRemark", manualRemarkSchema);
