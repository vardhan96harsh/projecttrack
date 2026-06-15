import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    type: {
      type: String,
      enum: ["public", "company", "optional"],
      default: "company",
    },
  },
  { timestamps: true }
);

holidaySchema.index({ date: 1 }, { unique: true });

export default mongoose.model("Holiday", holidaySchema);