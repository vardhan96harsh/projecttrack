import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || "dev");
  } catch (e) {
    console.error("JWT verify error:", e.message);

    // 🔵 Give clearer reason
    if (e.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    return res.status(401).json({ error: "Invalid token" });
  }

  // 🔵 Try DB lookup, but don't fail if DB hiccups
  let user = null;
  try {
    user = await User.findById(payload.id).select("_id name email role");
  } catch (err) {
    console.error("DB lookup failed:", err.message);
  }

  // 🔵 Always attach safe user object
  req.user = user || {
    _id: payload.id,
    role: payload.role || "employee",
    name: payload.name || "User",
  };

  next();
};

export const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};