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
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }

    return res.status(401).json({ error: "Invalid token", code: "INVALID_TOKEN" });
  }

  // 🔵 Try DB lookup and verify active status
  let user = null;
  try {
    user = await User.findById(payload.id).select("_id name email role status");
    if (!user) {
      return res.status(401).json({ error: "User no longer exists", code: "USER_NOT_FOUND" });
    }
    if (user.status === "inactive") {
      return res.status(403).json({ error: "Account is inactive", code: "USER_INACTIVE" });
    }
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
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Super Admin can perform ALL admin tasks and operations
  if (req.user.role === "superadmin") {
    return next();
  }

  if (role === "admin" && (req.user.role === "admin" || req.user.role === "superadmin")) {
    return next();
  }

  if (req.user.role !== role) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
};

export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden: Super Admin access required" });
  }
  next();
};