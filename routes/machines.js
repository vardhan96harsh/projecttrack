// backend/routes/machines.js
import express from "express";
import crypto from "crypto";
import Machine from "../models/Machine.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

/**
 * POST /api/machines/register
 * Called by the Electron desktop app ONCE (first run) or after app reinstall.
 * - Creates the machine if new
 * - Updates basic info if existing
 * - Returns a persistent machineToken
 */
router.post("/register", async (req, res) => {
  const { machineId, hostname, platform, user, mac, agentVersion } = req.body || {};
  if (!machineId) return res.status(400).json({ error: "machineId is required" });

  let mach = await Machine.findOne({ machineId });

  if (!mach) {
    mach = await Machine.create({
      machineId,
      machineToken: crypto.randomBytes(24).toString("hex"), // persist token
      hostname,
      platform,
      user,
      mac,
      agentVersion,
      lastSeenAt: new Date(), // <-- set on create too
    });
  } else {
    mach.hostname = hostname ?? mach.hostname;
    mach.platform = platform ?? mach.platform;
    mach.user = user ?? mach.user;
    mach.mac = mac ?? mach.mac;
    mach.agentVersion = agentVersion ?? mach.agentVersion;
    mach.lastSeenAt = new Date();
    await mach.save();
  }

  return res.json({
    ok: true,
    machineId: mach.machineId,
    machineToken: mach.machineToken,
    hostname: mach.hostname,
    platform: mach.platform,
    user: mach.user,
    mac: mach.mac,
    isDisabled: !!mach.isDisabled,
    lastSeenAt: mach.lastSeenAt,
  });
});

/**
 * POST /api/machines/ping
 * Optional lightweight heartbeat the agent can hit every N minutes
 * to keep lastSeenAt fresh—useful for an "Online/Offline" column in admin.
 */
router.post("/ping", async (req, res) => {
  const { machineId } = req.body || {};
  if (!machineId) return res.status(400).json({ error: "machineId is required" });

  const mach = await Machine.findOneAndUpdate(
    { machineId },
    { $set: { lastSeenAt: new Date() } },
    { new: true }
  );
  if (!mach) return res.status(404).json({ error: "machine not found" });

  return res.json({ ok: true, lastSeenAt: mach.lastSeenAt });
});

/**
 * GET /api/machines (admin)
 * Full list for admin view.
 */
router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  const rows = await Machine.find().sort({ updatedAt: -1 }).lean();
  res.json(rows);
});

/**
 * GET /api/machines/options (admin)
 * Compact list (id + nice label) for filters/dropdowns.
 */
router.get("/options", requireAuth, requireRole("admin"), async (_req, res) => {
  const rows = await Machine.find()
    .select("machineId hostname platform user lastSeenAt")
    .sort({ hostname: 1 })
    .lean();

  res.json(
    rows.map((m) => ({
      value: m.machineId,
      label: m.hostname || m.machineId,
      hint: `${m.platform || ""} • ${m.user || ""}`,
      lastSeenAt: m.lastSeenAt || null,
    }))
  );
});

export default router;
