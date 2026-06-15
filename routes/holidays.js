import express from "express";
import Holiday from "../models/Holiday.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ✅ GET (all or by month)
router.get("/", requireAuth, async (req, res) => {
  const { year, month } = req.query;

  const q = {};
  if (year && month) {
    const mm = String(month).padStart(2, "0");
    q.date = {
      $gte: `${year}-${mm}-01`,
      $lte: `${year}-${mm}-31`,
    };
  }

  const holidays = await Holiday.find(q).sort({ date: 1 });
  res.json(holidays);
});

// ✅ CREATE holiday
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, date, type } = req.body;

  if (!name || !date) {
    return res.status(400).json({ error: "Name and date required" });
  }

  const created = await Holiday.create({
    name: name.trim(),
    date,
    type: type || "company",
  });

  res.status(201).json(created);
});

// ✅ UPDATE holiday (EDIT)
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, date, type } = req.body;

  if (!name || !date) {
    return res.status(400).json({ error: "Name and date required" });
  }

  const updated = await Holiday.findByIdAndUpdate(
    req.params.id,
    {
      name: name.trim(),
      date,
      type: type || "company",
    },
    { new: true, runValidators: true }
  );

  if (!updated) {
    return res.status(404).json({ error: "Holiday not found" });
  }

  res.json(updated);
});

// ✅ DELETE holiday
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const deleted = await Holiday.findByIdAndDelete(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Holiday not found" });
  }

  res.json({ ok: true });
});

export default router;