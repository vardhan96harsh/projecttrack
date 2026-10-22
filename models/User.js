import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  employeeId: { type: String, trim: true, default: null },
  passwordHash: { type: String, required: true },

  role: { 
    type: String, 
    enum: ["superadmin", "admin", "employee"], 
    default: "employee" 
  },

  status: { 
    type: String, 
    enum: ["active", "inactive"], 
    default: "active" 
  },

  // Gender, DOB & Joining Date
  gender: {
    type: String,
    enum: ["Male", "Female"],
    default: null
  },
  dob: {
    type: Date,
    default: null,
  },
  joiningDate: {
    type: Date,
    default: null,
  },

  // Designation
  designation: {
    type: String,
    enum: [
      "Instructional Designer",
      "Quality Analyst",
      "Storyline Developer",
      "Graphic Designer",
      "Animator",
      "Manager",
      "Software Developer"
    ],
    default: null
  },

  // 🔒 Restricted Personal Information (Field-level access control enforced in routes)
  personalDetails: {
    phone: { type: String, default: "" },
    alternateEmail: { type: String, default: "" },
    emergencyContact: {
      name: { type: String, default: "" },
      relation: { type: String, default: "" },
      phone: { type: String, default: "" }
    },
    currentAddress: { type: String, default: "" },
    permanentAddress: { type: String, default: "" },
    panNumber: { type: String, default: "" },
    nationalId: { type: String, default: "" }, // Aadhaar / National ID
    bankDetails: {
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      bankName: { type: String, default: "" }
    },

    // 📄 Document Verification & Submission Checklist
    documents: {
      // 🔒 Super Admin Exclusive Document Checks (User CANNOT see)
      offerLetter: {
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" }, // "Available", "Pending", "Not Required"
        remarks: { type: String, default: "" }
      },
      twoPhotos: {
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" }, // "Available", "Pending"
        remarks: { type: String, default: "" }
      },

      // 👁️ Visible to User (Self) & Super Admin
      aadhaarDoc: {
        number: { type: String, default: "" },
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" },
        remarks: { type: String, default: "" }
      },
      panDoc: {
        number: { type: String, default: "" },
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" },
        remarks: { type: String, default: "" }
      },
      previousExperienceDoc: {
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" },
        companyName: { type: String, default: "" },
        designation: { type: String, default: "" },
        remarks: { type: String, default: "" }
      },
      originalDoc: {
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" },
        docName: { type: String, default: "" }, // e.g. Degree Certificate, 10th Marksheet
        remarks: { type: String, default: "" }
      },
      chequeDoc: {
        isAvailable: { type: Boolean, default: false },
        status: { type: String, default: "Pending" },
        bankName: { type: String, default: "" },
        chequeNumber: { type: String, default: "" },
        remarks: { type: String, default: "" }
      }
    },

    // 💰 STRICTLY SUPER ADMIN ONLY (Compensation, Increments & Salary Info - User CANNOT see)
    salaryDetails: {
      salaryStartDate: { type: Date, default: null },
      currentSalary: { type: String, default: "" },
      lastSalary: { type: String, default: "" },
      lastIncrementDate: { type: Date, default: null },
      incrementDetails: { type: String, default: "" },
      salaryAccount: { type: String, default: "" },
      remarks: { type: String, default: "" },
      // 📈 Multiple Salary Increments History (Chronological logs: 5-6+ increments over time)
      increments: [
        {
          incrementDate: { type: Date, default: null },
          previousSalary: { type: String, default: "" },
          newSalary: { type: String, default: "" },
          hikePercentage: { type: String, default: "" },
          reason: { type: String, default: "" },
          remarks: { type: String, default: "" }
        }
      ]
    }
  }

}, { timestamps: true });

export default mongoose.model("User", userSchema);
