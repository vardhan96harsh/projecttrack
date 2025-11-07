import jwt from "jsonwebtoken";
import User from "../models/User.js"; // ✅ Add this line

// ✅ This middleware verifies token and attaches full user data
export const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    // verify token (use the same secret you used when generating the token)
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev");

    // ✅ Fetch the full user from DB (not just ID from token)
    // If your token has { id: user._id }, use payload.id
    // If your token has { userId: user._id }, change to payload.userId
    const user = await User.findById(payload.id).select("_id name email role");
    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = user; // ✅ attach user object to the request
    next();
  } catch (e) {
    console.error("Auth error:", e);
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ✅ Check if the logged-in user has the required role (admin, employee, etc.)
export const requireRole = (role) => (req, res, next) => {
  if (!req.user || req.user.role !== role) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};
