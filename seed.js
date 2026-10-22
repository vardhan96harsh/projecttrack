import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
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

  // 1. Ensure Super Admin Account
  const superAdminEmail = "superadmin@demo.com";
  let superAdmin = await User.findOne({ email: superAdminEmail });
  if (!superAdmin) {
    const hash = await bcrypt.hash("SuperAdmin@123", 10);
    superAdmin = await User.create({
      name: "Super Admin",
      email: superAdminEmail,
      employeeId: "EMP-001",
      passwordHash: hash,
      role: "superadmin",
      status: "active",
      personalDetails: {
        phone: "+91 98765 43210",
        alternateEmail: "superadmin.backup@demo.com",
        emergencyContact: {
          name: "Main HQ",
          relation: "Organization",
          phone: "+91 98765 00000"
        },
        currentAddress: "Executive Suite 1, Alogic Tech Park",
        permanentAddress: "Executive Suite 1, Alogic Tech Park",
        panNumber: "ABCDE1234F",
        nationalId: "1234-5678-9012",
        bankDetails: {
          accountNumber: "998877665544",
          ifscCode: "HDFC0001234",
          bankName: "HDFC Bank"
        }
      }
    });
    console.log("✅ Super Admin created:", superAdminEmail, "Password: SuperAdmin@123");
  } else {
    let changed = false;
    if (superAdmin.role !== "superadmin") {
      superAdmin.role = "superadmin";
      changed = true;
    }
    if (!superAdmin.employeeId) {
      superAdmin.employeeId = "EMP-001";
      changed = true;
    }
    if (changed) {
      await superAdmin.save();
      console.log("✅ Updated superadmin role/empId:", superAdminEmail);
    } else {
      console.log("Super Admin already exists:", superAdminEmail);
    }
  }

  // 2. Ensure Regular Admin Account
  const adminEmail = "admin@demo.com";
  const adminExists = await User.findOne({ email: adminEmail });
  if (!adminExists) {
    const hash = await bcrypt.hash("Pass@123", 10);
    await User.create({ name: "Admin", email: adminEmail, employeeId: "EMP-002", passwordHash: hash, role: "admin", status: "active" });
    console.log("Admin created:", adminEmail, "Pass@123");
  } else {
    if (!adminExists.employeeId) {
      adminExists.employeeId = "EMP-002";
      await adminExists.save();
    }
    console.log("Admin already exists:", adminEmail);
  }

  // 3. Ensure default categories
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

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
