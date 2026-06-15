import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
        description: {
      type: String,
      trim: true,
      default: "",
    },
    code: {
  type: String,
  trim: true,
  default: "",
},

status: {
  type: String,
  enum: ["active", "hold", "completed", "cancelled"],
  default: "active",
},
  },
  { timestamps: true }
);

projectSchema.index(
  { name: 1, company: 1, category: 1 },
  { unique: true }
);

export default mongoose.model("Project", projectSchema);