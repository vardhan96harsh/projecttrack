// cron/autoStopSessions.js
import WorkSession from "../models/WorkSession.js";

const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 15);

function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function autoStopAbandonedSessions() {
  const todayStr = ymd(new Date());

  // 🔹 1) Proactively auto-stop any sessions from previous days left active or paused
  try {
    const previousDaySessions = await WorkSession.find({
      date: { $lt: todayStr },
      status: { $in: ["active", "paused"] },
    });

    for (const s of previousDaySessions) {
      if (s.status === "active" && s.currentStart) {
        const end = s.lastHeartbeatAt || new Date(new Date(s.currentStart).getTime() + HEARTBEAT_TIMEOUT_MIN * 60 * 1000);
        s.segments.push({ start: s.currentStart, end, source: "auto-stop-day-end" });
        const ms = end.getTime() - new Date(s.currentStart).getTime();
        s.accumulatedMinutes = (s.accumulatedMinutes || 0) + (ms > 0 ? ms / 60000 : 0);
        s.currentStart = null;
      }
      s.status = "stopped";
      if (!s.remarks?.includes("Auto-closed on day-end")) {
        s.remarks = s.remarks ? `${s.remarks} | Auto-closed on day-end` : "Auto-closed on day-end";
      }
      await s.save();
    }

    if (previousDaySessions.length) {
      console.log(`⏹️ Auto-closed past day sessions: ${previousDaySessions.length}`);
    }
  } catch (err) {
    console.error("Error auto-closing past day sessions:", err.message);
  }

  // 🔹 2) Auto-pause today's abandoned active sessions (no heartbeat)
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

    s.segments.push({ start: s.currentStart, end: endTime, source: "auto-pause-heartbeat" });

    const ms = endTime.getTime() - new Date(s.currentStart).getTime();
    const minutes = ms > 0 ? ms / 60000 : 0;
    s.accumulatedMinutes = (s.accumulatedMinutes || 0) + minutes;

    s.currentStart = null;
    s.status = "paused"; // idle → pause, not stop
    s.pausedAt = endTime || new Date();
    s.remarks = s.remarks
      ? `${s.remarks} | Auto-paused (no heartbeat)`
      : "Auto-paused (no heartbeat)";

    await s.save();
  }

  if (sessions.length) {
    console.log(`⏸️ Auto-paused abandoned sessions (no heartbeat): ${sessions.length}`);
  }
}

