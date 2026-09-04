import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import categoryRoutes from "./routes/categories.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
// import timesheetRoutes from "./routes/timesheets.js";
import reportRoutes from "./routes/reports.js";
import machinesRouter from "./routes/machines.js";
import workSessionsRouter from "./routes/workSessions.js";
import manualRemarkRoutes from "./routes/manualRemarks.js";
import { autoStopAbandonedSessions } from "./cron/autoStopSessions.js";
import taskRoutes from "./routes/tasks.js";
import projectPlanRoutes from "./routes/projectPlans.js";
import holidayRoutes from "./routes/holidays.js";

dotenv.config();

const app = express();

// CORS (local + desktop + production)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Electron file://, mobile apps, curl, etc.)
      if (!origin || origin === "null" || origin === "file://" || origin.startsWith("file://")) {
        return callback(null, true);
      }
      const allowedPatterns = [
        /^http:\/\/localhost(:\d+)?$/,
        /^http:\/\/127\.0\.0\.1(:\d+)?$/,
        /\.onrender\.com$/,
        /^http:\/\/13\.201\.46\.13(:\d+)?$/,
      ];
      const isAllowed = allowedPatterns.some((pattern) => pattern.test(origin));
      if (isAllowed) {
        return callback(null, true);
      }
      // Fallback allow in production to prevent desktop app blockages
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

app.use(express.json());

// Health check
app.get("/", (_req, res) => res.json({ ok: true, name: "ProjectTrack API" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/users", userRoutes);
// app.use("/api/timesheets", timesheetRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/machines", machinesRouter);
app.use("/api/work-sessions", workSessionsRouter);
app.use("/api/manual-remarks", manualRemarkRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/project-plans", projectPlanRoutes);

const PORT = process.env.PORT || 3001;
const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";

// mongoose
//   .connect(MONGO)
//   .then(() => {
//     console.log("✅ MongoDB connected");
//     app.listen(PORT, "0.0.0.0", () =>
//       console.log("🚀 API listening on", PORT)
//     );
//   })
//   .catch((err) => {
//     console.error("❌ Mongo connection error:", err.message);
//     process.exit(1);
//   });




      mongoose
      .connect(MONGO)
      .then(() => {
        console.log("✅ MongoDB connected");

        app.listen(PORT, "0.0.0.0", () => {
          console.log("🚀 API listening on", PORT);

          // ✅ Run once immediately (optional but helpful)
          autoStopAbandonedSessions().catch((e) =>
            console.error("autoStop first run error:", e)
          );

          // ✅ Then run every 1 minute
        setInterval(async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.warn("Mongo not connected, skipping autoStop");
      return;
    }

    await autoStopAbandonedSessions();
  } catch (e) {
    console.error("autoStop interval error (ignored):", e.message);
  }
}, 60 * 1000);

        });
      })
      .catch((err) => {
        console.error("❌ Mongo connection error:", err.message);
        process.exit(1);
      });

