import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { requireAuth, requireRole, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

function cleanDate(val, fallback = null) {
  if (typeof val === "undefined") return fallback;
  if (!val || val === "") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 👤 GET /api/users/me/profile
 * Allows any authenticated user (employee, admin, superadmin) to view their own profile,
 * including their own personal details.
 */
router.get("/me/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isSuper = req.user.role === "superadmin";
    let personalDetails = user.personalDetails?.toObject?.() || user.personalDetails || {};

    // 🔒 Field-level privacy protection:
    // If not superadmin (employee or regular admin):
    // - salaryDetails is completely omitted
    // - documents.offerLetter and documents.twoPhotos are omitted
    if (!isSuper) {
      personalDetails = JSON.parse(JSON.stringify(personalDetails));
      delete personalDetails.salaryDetails;
      if (personalDetails.documents) {
        delete personalDetails.documents.offerLetter;
        delete personalDetails.documents.twoPhotos;
      }
    }

    res.json({
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      employeeId: user.employeeId || null,
      role: user.role,
      status: user.status || "active",
      gender: user.gender,
      designation: user.designation,
      dob: user.dob,
      joiningDate: user.joiningDate,
      personalDetails,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("GET ME PROFILE ERROR:", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

/**
 * 👤 PUT /api/users/me/profile
 * Allows an employee to update their own contact & address information.
 * Sensitive fields (role, status, email, panNumber, nationalId, bankDetails) cannot be modified here.
 */
router.put("/me/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { phone, alternateEmail, emergencyContact, currentAddress, permanentAddress } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.personalDetails) {
      user.personalDetails = {};
    }

    if (typeof phone !== "undefined") user.personalDetails.phone = phone;
    if (typeof alternateEmail !== "undefined") user.personalDetails.alternateEmail = alternateEmail;
    if (typeof currentAddress !== "undefined") user.personalDetails.currentAddress = currentAddress;
    if (typeof permanentAddress !== "undefined") user.personalDetails.permanentAddress = permanentAddress;
    if (emergencyContact && typeof emergencyContact === "object") {
      user.personalDetails.emergencyContact = {
        name: emergencyContact.name || "",
        relation: emergencyContact.relation || "",
        phone: emergencyContact.phone || ""
      };
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      personalDetails: user.personalDetails
    });
  } catch (err) {
    console.error("PUT ME PROFILE ERROR:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/**
 * 📋 GET /api/users
 * Accessible by both Admin and Super Admin.
 * Field-level access control:
 * - If caller is SUPERADMIN: includes full personalDetails.
 * - If caller is ADMIN: personalDetails is strictly excluded / omitted.
 */
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status === "active") {
      filter.status = { $ne: "inactive" };
    } else if (status === "inactive") {
      filter.status = "inactive";
    } else if (status && status !== "all") {
      filter.status = status;
    }

    const isSuper = req.user?.role === "superadmin";

    const users = await User.find(filter)
      .collation({ locale: "en", strength: 2 })
      .sort({ name: 1 });

    res.json(users.map(u => {
      const base = {
        _id: u._id,
        id: u._id,
        name: u.name,
        email: u.email,
        employeeId: u.employeeId || null,
        role: u.role,
        status: u.status || "active",
        gender: u.gender,
        designation: u.designation,
        dob: u.dob,
        joiningDate: u.joiningDate
      };

      // 🔒 Personal data only exposed if caller is Super Admin
      if (isSuper) {
        base.personalDetails = u.personalDetails || {
          phone: "",
          alternateEmail: "",
          emergencyContact: { name: "", relation: "", phone: "" },
          currentAddress: "",
          permanentAddress: "",
          panNumber: "",
          nationalId: "",
          bankDetails: { accountNumber: "", ifscCode: "", bankName: "" },
          documents: {},
          salaryDetails: {}
        };
      }

      return base;
    }));
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * ➕ POST /api/users
 * Create a new user.
 * - Only Super Admin can assign the "superadmin" role.
 * - Only Super Admin can supply personalDetails upon creation.
 */
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      name,
      email,
      employeeId,
      password,
      role = "employee",
      status = "active",
      gender,
      designation,
      dob,
      joiningDate,
      personalDetails
    } = req.body;

    if (!name || !email || !password) return res.status(400).json({ error: "Missing required fields (name, email, password)" });

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if user already exists
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const isSuper = req.user?.role === "superadmin";

    // Prevent non-superadmins from creating a superadmin
    if (role === "superadmin" && !isSuper) {
      return res.status(403).json({ error: "Only Super Admin can create Super Admin accounts" });
    }

    const hash = await bcrypt.hash(password, 10);
    const userData = {
      name: String(name).trim(),
      email: normalizedEmail,
      employeeId: employeeId ? String(employeeId).trim() : null,
      passwordHash: hash,
      role,
      status,
      gender: gender || null,
      designation: designation || null,
      dob: cleanDate(dob, null),
      joiningDate: cleanDate(joiningDate, null)
    };

    // Only attach personalDetails if provided by Super Admin
    if (isSuper && personalDetails && typeof personalDetails === "object") {
      userData.personalDetails = personalDetails;
    }

    const created = await User.create(userData);

    const responseData = {
      id: created._id,
      name: created.name,
      email: created.email,
      employeeId: created.employeeId || null,
      role: created.role,
      status: created.status,
      gender: created.gender,
      designation: created.designation,
      dob: created.dob,
      joiningDate: created.joiningDate
    };

    if (isSuper && created.personalDetails) {
      responseData.personalDetails = created.personalDetails;
    }

    res.status(201).json(responseData);
  } catch (err) {
    console.error("POST USER ERROR:", err);
    if (err.code === 11000) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    res.status(500).json({ error: err.message || "Failed to create user" });
  }
});

/**
 * ✏️ PUT /api/users/:id
 * Update user account.
 * - Non-superadmin cannot edit Super Admin accounts.
 * - Non-superadmin cannot promote someone to "superadmin".
 * - Only Super Admin can update personalDetails.
 */
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const isSuper = req.user?.role === "superadmin";
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Prevent non-superadmin from editing a superadmin
    if (targetUser.role === "superadmin" && !isSuper) {
      return res.status(403).json({ error: "Only Super Admin can modify Super Admin accounts" });
    }

    const { name, email, employeeId, role, status, password, gender, designation, dob, joiningDate, personalDetails } = req.body;

    // Prevent non-superadmin from promoting any user to superadmin
    if (role === "superadmin" && !isSuper) {
      return res.status(403).json({ error: "Only Super Admin can assign the Super Admin role" });
    }

    if (email && email.toLowerCase() !== targetUser.email.toLowerCase()) {
      const emailConflict = await User.findOne({ email: email.trim().toLowerCase(), _id: { $ne: targetUser._id } });
      if (emailConflict) {
        return res.status(409).json({ error: "Another user already uses this email" });
      }
    }

    const update = {
      name: name ? String(name).trim() : targetUser.name,
      email: email ? String(email).trim().toLowerCase() : targetUser.email,
      role: role || targetUser.role,
      status: status || targetUser.status,
      gender: typeof gender !== "undefined" ? gender : targetUser.gender,
      designation: typeof designation !== "undefined" ? designation : targetUser.designation,
      dob: cleanDate(dob, targetUser.dob)
    };

    if (typeof employeeId !== "undefined") {
      update.employeeId = employeeId ? String(employeeId).trim() : null;
    }

    if (typeof joiningDate !== "undefined") {
      update.joiningDate = cleanDate(joiningDate, null);
    }

    if (password) update.passwordHash = await bcrypt.hash(password, 10);

    // 🔒 Personal details update allowed exclusively for Super Admin
    if (isSuper && personalDetails && typeof personalDetails === "object") {
      const existing = targetUser.personalDetails?.toObject?.() || targetUser.personalDetails || {};
      update.personalDetails = {
        ...existing,
        ...personalDetails,
        emergencyContact: {
          ...(existing.emergencyContact || {}),
          ...(personalDetails.emergencyContact || {})
        },
        bankDetails: {
          ...(existing.bankDetails || {}),
          ...(personalDetails.bankDetails || {})
        },
        documents: {
          ...(existing.documents || {}),
          ...(personalDetails.documents || {})
        },
        salaryDetails: {
          ...(existing.salaryDetails || {}),
          ...(personalDetails.salaryDetails || {}),
          salaryStartDate: cleanDate(personalDetails.salaryDetails?.salaryStartDate, existing.salaryDetails?.salaryStartDate),
          lastIncrementDate: cleanDate(personalDetails.salaryDetails?.lastIncrementDate, existing.salaryDetails?.lastIncrementDate),
          increments: Array.isArray(personalDetails.salaryDetails?.increments)
            ? personalDetails.salaryDetails.increments.map(inc => ({
                ...inc,
                incrementDate: cleanDate(inc.incrementDate, null)
              }))
            : (existing.salaryDetails?.increments || [])
        }
      };
    }

    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });

    const responseData = {
      id: updated._id,
      name: updated.name,
      email: updated.email,
      employeeId: updated.employeeId || null,
      role: updated.role,
      status: updated.status,
      gender: updated.gender,
      designation: updated.designation,
      dob: updated.dob,
      joiningDate: updated.joiningDate
    };

    if (isSuper && updated.personalDetails) {
      responseData.personalDetails = updated.personalDetails;
    }

    res.json(responseData);
  } catch (err) {
    console.error("PUT USER ERROR:", err);
    if (err.code === 11000) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    res.status(500).json({ error: err.message || "Failed to update user" });
  }
});

/**
 * 🗑️ DELETE /api/users/:id
 * Delete user account.
 * - Super Admin accounts cannot be deleted.
 * - Regular Admin cannot delete other Admins (only Super Admin can).
 */
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const isSuper = req.user?.role === "superadmin";
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Super Admin accounts can NEVER be deleted
    if (user.role === "superadmin") {
      return res.status(403).json({ error: "Super Admin accounts cannot be deleted" });
    }

    // Prevent regular admin from deleting other admins
    if (user.role === "admin" && !isSuper) {
      return res.status(403).json({ error: "Only Super Admin can delete Administrator accounts" });
    }

    await user.deleteOne();
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("DELETE USER ERROR:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/**
 * 🎂 GET /api/users/birthdays/today
 */
router.get("/birthdays/today", requireAuth, async (req, res) => {
  try {
    const users = await User.find({
      status: { $ne: "inactive" },
      dob: { $ne: null },
    }).select("name dob status");

    const today = new Date();
    const localMonth = today.getMonth();
    const localDay = today.getDate();
    const utcMonth = today.getUTCMonth();
    const utcDay = today.getUTCDate();

    const birthdays = users.filter((u) => {
      if (!u.dob || u.status === "inactive") return false;
      const d = new Date(u.dob);
      if (isNaN(d.getTime())) return false;
      const matchesLocal = d.getMonth() === localMonth && d.getDate() === localDay;
      const matchesUTC = d.getUTCMonth() === utcMonth && d.getUTCDate() === utcDay;
      return matchesLocal || matchesUTC;
    });

    res.json(
      birthdays.map((u) => ({
        id: u._id,
        name: u.name,
        dob: u.dob,
      }))
    );
  } catch (err) {
    console.error("BIRTHDAYS TODAY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch today's birthdays" });
  }
});

export default router;
