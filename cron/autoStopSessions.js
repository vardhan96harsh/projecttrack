// cron/autoStopSessions.js
import WorkSession from "../models/WorkSession.js";

const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 10);

export async function autoStopAbandonedSessions() {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MIN * 60 * 1000);

const GRACE_MINUTES = 2;

const graceCutoff = new Date(
  Date.now() - GRACE_MINUTES * 60 * 1000
);

const sessions = await WorkSession.find({
  status: "active",
  currentStart: { $ne: null },

  // ❗ do NOT touch very new sessions
  createdAt: { $lt: graceCutoff },

  $or: [
    { lastHeartbeatAt: { $lt: cutoff } },
    { lastHeartbeatAt: null }
  ],
});


  for (const s of sessions) {
    const endTime = new Date();

    s.segments.push({ start: s.currentStart, end: endTime });

    const minutes = (endTime - new Date(s.currentStart)) / 60000;
    s.accumulatedMinutes =
      (s.accumulatedMinutes || 0) + Math.max(0, minutes);

    s.currentStart = null;
    s.status = "stopped";

    s.remarks = s.remarks
      ? `${s.remarks} | Auto-stopped (no heartbeat)`
      : "Auto-stopped (no heartbeat)";

    await s.save();
  }

  if (sessions.length) {
    console.log(`🛑 Auto-stopped sessions: ${sessions.length}`);
  }
}
