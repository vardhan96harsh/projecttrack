import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import companyRoutes from "./routes/companies.js";
import categoryRoutes from "./routes/categories.js";
import projectRoutes from "./routes/projects.js";
import userRoutes from "./routes/users.js";
import timesheetRoutes from "./routes/timesheets.js";
import reportRoutes from "./routes/reports.js";
import machinesRouter from "./routes/machines.js";
import workSessionsRouter from "./routes/workSessions.js";


dotenv.config();


const app = express();

// ✅ Flexible CORS for local + Render + Electron apps
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5175",
      /\.onrender\.com$/,     // ✅ Allow any Render subdomain (for production)
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());


// then your usual middleware
app.use(express.json());

// simple health check
app.get("/", (_req, res) => res.json({ ok: true, name: "ProjectTrack API" }));

// routes
app.use("/api/auth", authRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/users", userRoutes);
app.use("/api/timesheets", timesheetRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/machines", machinesRouter);
app.use("/api/work-sessions", workSessionsRouter);




const PORT = process.env.PORT || 3001;
const MONGO = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/projecttrack";

mongoose
  .connect(MONGO)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log("API listening on port", PORT));
  })
  .catch((err) => {
    console.error("Mongo connection error", err);
    process.exit(1);
  });
