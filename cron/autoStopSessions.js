// cron/autoStopSessions.js
import WorkSession from "../models/WorkSession.js";

const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 15);

export async function autoStopAbandonedSessions() {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MIN * 60 * 1000);

  const sessions = await WorkSession.find({
    status: "active",
    currentStart: { $ne: null },
    lastHeartbeatAt: { $lt: cutoff },
  });

  for (const s of sessions) {
const endTime = s.lastHeartbeatAt || new Date();

    s.segments.push({ start: s.currentStart, end: endTime });

    const minutes = (endTime - new Date(s.currentStart)) / 60000;
    s.accumulatedMinutes =
      (s.accumulatedMinutes || 0) + Math.max(0, minutes);

    s.currentStart = null;
   s.status = "paused"; // idle → pause, not stop
s.remarks = s.remarks
  ? `${s.remarks} | Auto-paused (no heartbeat)`
  : "Auto-paused (no heartbeat)";

    await s.save();
  }

  if (sessions.length) {
    console.log(`🛑 Auto-stopped sessions: ${sessions.length}`);
  }
}

