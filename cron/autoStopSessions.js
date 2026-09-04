// cron/autoStopSessions.js
import WorkSession from "../models/WorkSession.js";

const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 15);

export async function autoStopAbandonedSessions() {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MIN * 60 * 1000);

  const sessions = await WorkSession.find({
    status: "active",
    currentStart: { $ne: null },
    $or: [
      { lastHeartbeatAt: { $lt: cutoff } },
      { lastHeartbeatAt: null, currentStart: { $lt: cutoff } },
    ],
  });

  for (const s of sessions) {
    let endTime = s.lastHeartbeatAt;
    if (!endTime || endTime < new Date(s.currentStart)) {
      endTime = new Date(
        new Date(s.currentStart).getTime() + HEARTBEAT_TIMEOUT_MIN * 60 * 1000
      );
    }
    if (endTime > new Date()) endTime = new Date();

    s.segments.push({ start: s.currentStart, end: endTime });

    const ms = endTime.getTime() - new Date(s.currentStart).getTime();
    const minutes = ms > 0 ? ms / 60000 : 0;
    s.accumulatedMinutes = (s.accumulatedMinutes || 0) + minutes;

    s.currentStart = null;
    s.status = "paused"; // idle → pause, not stop
    s.remarks = s.remarks
      ? `${s.remarks} | Auto-paused (no heartbeat)`
      : "Auto-paused (no heartbeat)";

    await s.save();
  }

  if (sessions.length) {
    console.log(`🛑 Auto-stopped abandoned sessions: ${sessions.length}`);
  }
}
