
import mongoose from "mongoose";
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },

  role: { 
    type: String, 
    enum: ["admin", "employee"], 
    default: "employee" 
  },

  status: { 
    type: String, 
    enum: ["active", "inactive"], 
    default: "active" 
  },

  // ✅ NEW FIELD
  gender: {
    type: String,
    enum: ["Male", "Female"],
    default: null
  },

  // ✅ NEW FIELD
  designation: {
    type: String,
    enum: [
      "Instructional Designer",
      "Quality Analyst",
      "Storyline Developer",
      "Graphic Designer",
      "Animator",
      "Manager",
      "Software Developer"
    ],
    default: null
  }

}, { timestamps: true });

export default mongoose.model("User", userSchema);
