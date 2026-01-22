
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users.map(u => ({
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    gender: u.gender,          // ✅ ADDED
    designation: u.designation // ✅ ADDED
  })));

});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const {
    name,
    email,
    password,
    role = "employee",
    status = "active",
    gender,        // ✅ ADDED
    designation    // ✅ ADDED
  } = req.body;

  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const hash = await bcrypt.hash(password, 10);
  const created = await User.create({
    name,
    email,
    passwordHash: hash,
    role,
    status,
    gender,        // ✅ ADDED
    designation    // ✅ ADDED
  });

  res.status(201).json({ id: created._id, name: created.name, email: created.email, role: created.role, status: created.status,
  gender: created.gender,
  designation: created.designation });
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, email, role, status, password, gender, designation } = req.body;

  const update = {
    name,
    email,
    role,
    status,
    gender,        // ✅ ADDED
    designation    // ✅ ADDED
  };

  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const updated = await User.findByIdAndUpdate(req.params.id, update,  { new: true, runValidators: true });
  res.json({ id: updated._id, name: updated.name, email: updated.email, role: updated.role, status: updated.status,
  gender: updated.gender,
  designation: updated.designation });
});

// router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
//   await User.findByIdAndDelete(req.params.id);
//   res.json({ ok: true });
// });
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // ✅ Prevent deleting admin accounts
  if (user.role === "admin") {
    return res.status(403).json({ error: "Admin accounts cannot be deleted" });
  }

  await user.deleteOne();
  res.json({ message: "User deleted successfully" });
});

export default router;
