import express from "express";
import mongoose from "mongoose";
import Holiday from "../models/Holiday.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const VALID_TYPES = ["public", "company", "optional"];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidDate = (d) => {
  if (typeof d !== "string" || !DATE_REGEX.test(d)) return false;
  const parsed = new Date(d);
  return !isNaN(parsed.getTime());
};

// ✅ GET (all or by year/month)
router.get("/", requireAuth, async (req, res) => {
  try {
    let { year, month } = req.query;

    const q = {};

    // Fallback: If month is specified without year, default to current year
    if (month && !year) {
      year = new Date().getFullYear();
    }

    if (year && month) {
      const m = parseInt(month, 10);
      if (isNaN(m) || m < 1 || m > 12) {
        return res.status(400).json({ error: "Month must be between 1 and 12" });
      }
      const mm = String(m).padStart(2, "0");
      q.date = {
        $gte: `${year}-${mm}-01`,
        $lte: `${year}-${mm}-31`,
      };
    } else if (year) {
      q.date = {
        $gte: `${year}-01-01`,
        $lte: `${year}-12-31`,
      };
    }

    const holidays = await Holiday.find(q).sort({ date: 1 });
    res.json(holidays);
  } catch (err) {
    console.error("GET HOLIDAYS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch holidays" });
  }
});

// ✅ CREATE holiday
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, date, type } = req.body || {};

    if (!name?.trim() || !date) {
      return res.status(400).json({ error: "Name and date required" });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
    }

    const holidayType = type || "company";
    if (!VALID_TYPES.includes(holidayType)) {
      return res.status(400).json({
        error: `Invalid holiday type. Allowed types: ${VALID_TYPES.join(", ")}`,
      });
    }

    const created = await Holiday.create({
      name: name.trim(),
      date,
      type: holidayType,
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("CREATE HOLIDAY ERROR:", err);
    if (err.code === 11000) {
      return res.status(409).json({ error: "A holiday on this date already exists" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to create holiday" });
  }
});

// ✅ UPDATE holiday (EDIT)
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid holiday ID" });
    }

    const { name, date, type } = req.body || {};

    if (!name?.trim() || !date) {
      return res.status(400).json({ error: "Name and date required" });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
    }

    const holidayType = type || "company";
    if (!VALID_TYPES.includes(holidayType)) {
      return res.status(400).json({
        error: `Invalid holiday type. Allowed types: ${VALID_TYPES.join(", ")}`,
      });
    }

    const updated = await Holiday.findByIdAndUpdate(
      id,
      {
        name: name.trim(),
        date,
        type: holidayType,
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Holiday not found" });
    }

    res.json(updated);
  } catch (err) {
    console.error("UPDATE HOLIDAY ERROR:", err);
    if (err.code === 11000) {
      return res.status(409).json({ error: "A holiday on this date already exists" });
    }
    if (err.name === "ValidationError" || err.name === "CastError") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Failed to update holiday" });
  }
});

// ✅ DELETE holiday
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid holiday ID" });
    }

    const deleted = await Holiday.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Holiday not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE HOLIDAY ERROR:", err);
    if (err.name === "CastError") {
      return res.status(400).json({ error: "Invalid holiday ID" });
    }
    res.status(500).json({ error: "Failed to delete holiday" });
  }
});

export default router;