// cron/autoStopSessions.js
import WorkSession from "../models/WorkSession.js";

const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 60);
const IST_OFFSET_MS = 5.5 * 3600 * 1000; // 5 hours 30 mins (Asia/Kolkata / IST)

function ymd(d = new Date()) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const istDate = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
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
        let maxClosedEnd = 0;
        if (Array.isArray(s.segments)) {
          for (const seg of s.segments) {
            if (seg.end) {
              const et = new Date(seg.end).getTime();
              if (et > maxClosedEnd) maxClosedEnd = et;
            }
          }
        }
        const effectiveStart = Math.max(new Date(s.currentStart).getTime(), maxClosedEnd);
        let end = s.lastHeartbeatAt || new Date(effectiveStart + HEARTBEAT_TIMEOUT_MIN * 60 * 1000);
        if (end.getTime() > effectiveStart) {
          s.segments.push({ start: new Date(effectiveStart), end, source: "auto-stop-day-end" });
        }
        // Recalculate accumulatedMinutes from clean segments
        let segMs = 0;
        for (const seg of s.segments) {
          if (seg.start && seg.end) {
            const st = new Date(seg.start).getTime();
            const et = new Date(seg.end).getTime();
            if (et > st) segMs += (et - st);
          }
        }
        s.accumulatedMinutes = Math.min(1440, Math.round((segMs / 60000) * 100) / 100);
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
    let maxClosedEnd = 0;
    if (Array.isArray(s.segments)) {
      for (const seg of s.segments) {
        if (seg.end) {
          const et = new Date(seg.end).getTime();
          if (et > maxClosedEnd) maxClosedEnd = et;
        }
      }
    }

    const effectiveStart = Math.max(new Date(s.currentStart).getTime(), maxClosedEnd);
    let endTime = s.lastHeartbeatAt;
    if (!endTime || endTime.getTime() < effectiveStart) {
      endTime = new Date(effectiveStart + HEARTBEAT_TIMEOUT_MIN * 60 * 1000);
    }
    if (endTime > new Date()) endTime = new Date();

    if (endTime.getTime() > effectiveStart) {
      s.segments.push({
        start: new Date(effectiveStart),
        end: endTime,
        source: "auto-pause-heartbeat",
      });
    }

    // Recalculate accumulatedMinutes strictly from clean non-overlapping segments
    let segMs = 0;
    if (Array.isArray(s.segments)) {
      for (const seg of s.segments) {
        if (seg.start && seg.end) {
          const st = new Date(seg.start).getTime();
          const et = new Date(seg.end).getTime();
          if (et > st) segMs += (et - st);
        }
      }
    }
    s.accumulatedMinutes = Math.min(1440, Math.round((segMs / 60000) * 100) / 100);

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

