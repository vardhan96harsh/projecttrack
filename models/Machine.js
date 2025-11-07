// backend/models/Machine.js
import mongoose from "mongoose";

const machineSchema = new mongoose.Schema(
  {
    machineId: { type: String, unique: true, index: true, required: true },
    machineToken: { type: String, required: true }, // simple random string is fine
    hostname: String,
    platform: String, // e.g., "win32 x64"
    user: String,
    mac: String,
    agentVersion: String,
    // backend/models/Machine.js
lastSeenAt: { type: Date, default: () => new Date() },

    firstSeenAt: { type: Date, default: Date.now },
    note: String, // optional - admin note/tag
  },
  { timestamps: true }
);

export default mongoose.model("Machine", machineSchema);
