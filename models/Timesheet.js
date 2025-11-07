
import mongoose from "mongoose";
const timesheetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  taskType: { type: String, enum: ["Alpha Development", "Beta Development", "Rework"], required: true },
  hours: { type: Number, required: true, min: 0.5 },
  remarks: { type: String },
  dateLogged: { type: Date, required: true }
}, { timestamps: true });

export default mongoose.model("Timesheet", timesheetSchema);
