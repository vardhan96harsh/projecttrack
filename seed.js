
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./models/User.js";
import Category from "./models/Category.js";

dotenv.config();

const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";

async function run() {
  await mongoose.connect(MONGO);
  console.log("Mongo connected");
  const adminEmail = "admin@demo.com";
  const exists = await User.findOne({ email: adminEmail });
  if (!exists) {
    const hash = await bcrypt.hash("Pass@123", 10);
    await User.create({ name: "Admin", email: adminEmail, passwordHash: hash, role: "admin", status: "active" });
    console.log("Admin created:", adminEmail, "Pass@123");
  } else {
    console.log("Admin already exists");
  }

  // Ensure default categories
  const defaults = ["eLearning", "Video", "PDF"];
  for (const name of defaults) {
    const c = await Category.findOne({ name });
    if (!c) {
      await Category.create({ name });
      console.log("Category created:", name);
    }
  }
  await mongoose.disconnect();
  console.log("Done.");
}

run().catch(e => { console.error(e); process.exit(1); });
