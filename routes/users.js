
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  const users = await User.find()
    .collation({ locale: "en", strength: 2 })
    .sort({ name: 1 });
  res.json(users.map(u => ({
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    gender: u.gender,
    designation: u.designation,
    dob: u.dob

  })));

});

router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const {
    name,
    email,
    password,
    role = "employee",
    status = "active",
    gender,
    designation,
    dob
  } = req.body;

  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const hash = await bcrypt.hash(password, 10);
  const created = await User.create({
    name,
    email,
    passwordHash: hash,
    role,
    status,
    gender: gender || null,
    designation: designation || null,
    dob: dob ? new Date(dob) : null
  });

  res.status(201).json({
    id: created._id, name: created.name, email: created.email, role: created.role, status: created.status,
    gender: created.gender,
    designation: created.designation, dob: created.dob
  });
});

router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, email, role, status, password, gender, designation, dob } = req.body;

  const update = {
    name,
    email,
    role,
    status,
    gender: gender || null,
    designation: designation || null,
    dob: dob ? new Date(dob) : null
  };

  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  res.json({
    id: updated._id, name: updated.name, email: updated.email, role: updated.role, status: updated.status,
    gender: updated.gender,
    designation: updated.designation, dob: updated.dob
  });
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


router.get("/birthdays/today", requireAuth, async (req, res) => {
  try {
    const users = await User.find({
      status: "active",
      dob: { $ne: null },
    }).select("name dob");

    const today = new Date();
    const localMonth = today.getMonth();
    const localDay = today.getDate();
    const utcMonth = today.getUTCMonth();
    const utcDay = today.getUTCDate();

    const birthdays = users.filter((u) => {
      if (!u.dob) return false;
      const d = new Date(u.dob);
      if (isNaN(d.getTime())) return false;
      // Match against local server date or UTC date to prevent timezone edge cases
      const matchesLocal = d.getMonth() === localMonth && d.getDate() === localDay;
      const matchesUTC = d.getUTCMonth() === utcMonth && d.getUTCDate() === utcDay;
      const matchesCross = (d.getMonth() === utcMonth && d.getDate() === utcDay) ||
                           (d.getUTCMonth() === localMonth && d.getUTCDate() === localDay);
      return matchesLocal || matchesUTC || matchesCross;
    });

    res.json(
      birthdays.map((u) => ({
        id: u._id,
        name: u.name,
        dob: u.dob,
      }))
    );
  } catch (err) {
    console.error("BIRTHDAYS TODAY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch today's birthdays" });
  }
});
export default router;
