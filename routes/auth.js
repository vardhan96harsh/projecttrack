import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (JWT_SECRET + "_refresh");
const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "2h";
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES || "90d";

export function generateTokens(user) {
  const token = jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );

  const refreshToken = jwt.sign(
    { id: user._id, type: "refresh" },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );

  return { token, refreshToken };
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    let query = User.findOne({ email });
    const user = await query.exec();
    const hashed = user?.passwordHash;

    // Use generic 401 to avoid account enumeration
    if (!user || !hashed) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, hashed);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    if (typeof user.status !== "undefined" && user.status !== "active") {
      return res.status(403).json({ error: "User inactive" });
    }

    const { token, refreshToken } = generateTokens(user);

    return res.json({
      token,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required", code: "REFRESH_TOKEN_REQUIRED" });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (e) {
      if (e.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "Refresh token expired. Please login again.",
          code: "REFRESH_TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({ error: "Invalid refresh token", code: "INVALID_REFRESH_TOKEN" });
    }

    if (payload.type !== "refresh" || !payload.id) {
      return res.status(401).json({ error: "Invalid refresh token payload", code: "INVALID_REFRESH_TOKEN" });
    }

    const user = await User.findById(payload.id).select("_id name email role status");
    if (!user) {
      return res.status(401).json({ error: "User no longer exists", code: "USER_NOT_FOUND" });
    }

    if (typeof user.status !== "undefined" && user.status !== "active") {
      return res.status(403).json({ error: "User inactive", code: "USER_INACTIVE" });
    }

    const tokens = generateTokens(user);

    return res.json({
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Refresh token error:", err);
    return res.status(500).json({ error: "Server error during token refresh" });
  }
});

export default router;