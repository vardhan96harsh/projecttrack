import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // If your schema has `passwordHash` with { select: false }, keep select('+passwordHash')
    // If your field is named `password` instead, change both lines accordingly.
    let query = User.findOne({ email });

    // 👉 Uncomment if passwordHash is select:false in schema:
    // query = query.select("+passwordHash +status");

    const user = await query.exec();
    // If you use `password` instead of `passwordHash`, change here too:
    const hashed = user?.passwordHash; // or user?.password

    // Use generic 401 to avoid account enumeration
    if (!user || !hashed) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, hashed);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Only keep this if your schema really has `status`
    if (typeof user.status !== "undefined" && user.status !== "active") {
      return res.status(403).json({ error: "User inactive" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET || "dev", // ⚠️ set JWT_SECRET in env for production
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login error: er", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
 