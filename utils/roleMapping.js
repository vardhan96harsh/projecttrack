// backend/utils/roleMapping.js

/**
 * Normalizes any role, title, or designation string to a canonical role key:
 * 'ID', 'DEVELOPER', 'QA', 'ANIMATOR', 'DESIGNER', 'PM', 'VO'
 */
export function normalizeRoleKey(roleOrDesig) {
  if (!roleOrDesig) return "DEVELOPER";
  const str = String(roleOrDesig).toUpperCase().trim();

  // Instructional Designer
  if (
    str === "ID" ||
    str === "INSTRUCTIONAL_DESIGNER" ||
    str.includes("INSTRUCTION") ||
    str.includes("STORYBOARD") ||
    str.includes("CONTENT") ||
    str.includes("SCRIPT") ||
    str.includes("CURRICULUM")
  ) {
    return "ID";
  }

  // Course / Storyline / Software Developer
  if (
    str === "DEV" ||
    str === "DEVELOPER" ||
    str.includes("DEVELOP") ||
    str.includes("STORYLINE") ||
    str.includes("RISE") ||
    str.includes("AUTHOR") ||
    str.includes("TYPESET") ||
    str.includes("SOFTWARE") ||
    str.includes("PROGRAMMER") ||
    str.includes("INTERACTION") ||
    str.includes("SCORM") ||
    str.includes("PACKAGING")
  ) {
    return "DEVELOPER";
  }

  // Quality Analyst / Tester
  if (
    str === "QA" ||
    str.includes("QA") ||
    str.includes("TEST") ||
    str.includes("VALIDAT") ||
    str.includes("QUALITY") ||
    str.includes("ACCESSIB") ||
    str.includes("COMPLIANCE") ||
    str.includes("PREFLIGHT")
  ) {
    return "QA";
  }

  // Animator / Motion Graphics
  if (
    str === "ANIM" ||
    str === "ANIMATOR" ||
    str === "MGD" ||
    str.includes("ANIM") ||
    str.includes("MOTION") ||
    str.includes("VIDEO") ||
    str.includes("2D")
  ) {
    return "ANIMATOR";
  }

  // Graphic Designer / Visual Designer
  if (
    str === "VD" ||
    str === "DESIGNER" ||
    str.includes("DESIGN") ||
    str.includes("GRAPHIC") ||
    str.includes("VISUAL") ||
    str.includes("UI") ||
    str.includes("ASSET") ||
    str.includes("INFOGRAPHIC")
  ) {
    return "DESIGNER";
  }

  // Project Manager
  if (
    str === "PM" ||
    str.includes("PM") ||
    str.includes("MANAGER") ||
    str.includes("KICKOFF") ||
    str.includes("CLOSURE") ||
    str.includes("HANDOVER") ||
    str.includes("COORDINAT")
  ) {
    return "PM";
  }

  // Voiceover / External Audio
  if (
    str === "VO" ||
    str.includes("VOICE") ||
    str.includes("AUDIO") ||
    str.includes("NARRAT")
  ) {
    return "VO";
  }

  return "DEVELOPER";
}

/**
 * Checks if a user's designation matches a task's discipline/role.
 * Admin and superadmin always match.
 */
export function doesUserMatchTaskRole(user, taskRoleOrCategory) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "superadmin") return true;

  const userNorm = normalizeRoleKey(user.designation || user.roleCategory);
  const taskNorm = normalizeRoleKey(taskRoleOrCategory);

  return userNorm === taskNorm;
}

