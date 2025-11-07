import express from "express";
import Timesheet from "../models/Timesheet.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
router.get("/summary", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { dim = "project", from, to } = req.query;

    const match = {};
    if (from || to) {
      match.dateLogged = {};
      if (from) match.dateLogged.$gte = new Date(from);
      if (to) match.dateLogged.$lte = new Date(to);
    }

    // which collection to look up + label field (+ extra)
    const cfg =
      {
        project:  { field: "$project",  coll: "projects",  label: "name" },
        company:  { field: "$company",  coll: "companies", label: "name" },
        category: { field: "$category", coll: "categories",label: "name" },
        user:     { field: "$user",     coll: "users",     label: "name", extra: "email" },
      }[dim] || { field: "$project", coll: "projects", label: "name" };

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: cfg.field,              // group by selected dimension
          totalHours: { $sum: "$hours" },
          entries: { $sum: 1 },
        },
      },
      { $sort: { totalHours: -1 } },
      {
        // robust lookup: works if timesheet stored string or ObjectId
        $lookup: {
          from: cfg.coll,
          let: { k: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$_id", "$$k"] },
                    {
                      $and: [
                        { $eq: [{ $type: "$$k" }, "string"] },
                        { $eq: ["$_id", { $toObjectId: "$$k" }] },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $project: Object.assign(
                { [cfg.label]: 1 },
                cfg.extra ? { [cfg.extra]: 1 } : {}
              ),
            },
          ],
          as: "meta",
        },
      },
      {
        $addFields: Object.assign(
          {
            label: {
              $ifNull: [{ $arrayElemAt: [`$meta.${cfg.label}`, 0] }, { $toString: "$_id" }],
            },
          },
          cfg.extra ? { email: { $arrayElemAt: [`$meta.${cfg.extra}`, 0] } } : {}
        ),
      },
      { $project: { meta: 0 } },
    ];

    const rows = await Timesheet.aggregate(pipeline);

    res.json(
      rows.map((r) => ({
        key: String(r._id ?? ""),
        label: r.label ?? String(r._id ?? ""),
        email: r.email || null,
        totalHours: r.totalHours || 0,
        entries: r.entries || 0,
      }))
    );
  } catch (err) {
    console.error("SUMMARY ERR:", err);
    res.status(500).json({ isOk: false, message: err?.message || "Summary failed" });
  }
});

// GET /api/reports/user-breakdown?user=<userId>&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns project-level aggregation for one employee within a date range
router.get(
  "/user-breakdown",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { user, from, to } = req.query;
      if (!user) return res.status(400).json({ error: "user is required" });

      const match = { user };
      if (from || to) {
        match.dateLogged = {};
        if (from) match.dateLogged.$gte = new Date(from);
        if (to) match.dateLogged.$lte = new Date(to);
      }

      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: "$project",
            totalHours: { $sum: "$hours" },
            entries: { $sum: 1 },
          },
        },
        // bring project/company/category names
        {
          $lookup: {
            from: "projects",
            localField: "_id",
            foreignField: "_id",
            as: "proj",
          },
        },
        { $set: { proj: { $first: "$proj" } } },
        {
          $lookup: {
            from: "companies",
            localField: "proj.company",
            foreignField: "_id",
            as: "comp",
          },
        },
        { $set: { comp: { $first: "$comp" } } },
        {
          $lookup: {
            from: "categories",
            localField: "proj.category",
            foreignField: "_id",
            as: "cat",
          },
        },
        { $set: { cat: { $first: "$cat" } } },
        {
          $project: {
            key: { $toString: "$_id" },
            projectName: { $ifNull: ["$proj.name", { $toString: "$_id" }] },
            companyName: "$comp.name",
            categoryName: "$cat.name",
            totalHours: 1,
            entries: 1,
          },
        },
        { $sort: { totalHours: -1 } },
      ];

      const rows = await Timesheet.aggregate(pipeline);
      res.json(rows);
    } catch (err) {
      console.error("user-breakdown error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);


// -------- CSV export for current filters --------
router.get("/export", requireAuth, requireRole("admin"), async (req, res) => {
  const { company, category, project, user, from, to, taskType } = req.query;

  const q = {};
  if (user) q.user = user;
  if (company) q.company = company;
  if (category) q.category = category;
  if (project) q.project = project;
  if (taskType) q.taskType = taskType;
  if (from || to) {
    q.dateLogged = {};
    if (from) q.dateLogged.$gte = new Date(from);
    if (to) q.dateLogged.$lte = new Date(to);
  }

  const items = await Timesheet.find(q)
    .populate("user", "name email")
    .populate("company", "name")
    .populate("category", "name")
    .populate("project", "name")
    .sort({ dateLogged: -1 });

  const header = [
    "Date",
    "Employee",
    "Company",
    "Category",
    "Project",
    "Task Type",
    "Hours",
    "Remarks",
  ];
  const lines = [header.join(",")];

  for (const t of items) {
    const row = [
      t.dateLogged ? t.dateLogged.toISOString().slice(0, 10) : "",
      t.user?.name || "",
      t.company?.name || "",
      t.category?.name || "",
      t.project?.name || "",
      t.taskType || "",
      t.hours != null ? String(t.hours) : "",
      (t.remarks || "").replace(/"/g, '""'),
    ]
      .map((v) => `"${v}"`)
      .join(",");

    // ✅ correct JS: push to array
    lines.push(row);
  }

  // Use CRLF so Excel opens it neatly on Windows
  const csv = lines.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=timesheets.csv");
  res.send(csv);
});

export default router;
