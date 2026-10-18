import { currentSchedule } from "../site/schedule.js";
import { proposedSchedule } from "../site/proposed-schedule.js";

const allowedValues = {
  classAttendanceStatus: new Set(["regular", "sometimes", "rarely", "never"]),
  barriers: new Set(["work", "school", "childcare", "commute", "class-full", "recovery", "none", "other"])
};

const classSchedule = makeScheduleMap(currentSchedule);
const proposedClassSchedule = makeScheduleMap(proposedSchedule);

function makeScheduleMap(schedule) {
  return new Map(schedule.flatMap((day) => day.classes.map((item) => [
    item.id, { day: day.day, time: item.time, program: item.program }
  ])));
}

export function validateSurveySubmission(body, options = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("Invalid submission.");

  const responseId = cleanString(body.responseId, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(responseId)) {
    return invalid("Invalid response ID.");
  }
  const surveyVersion = cleanString(body.surveyVersion, 24);
  if (surveyVersion !== "2026-10-18") return invalid("This survey has changed. Refresh the page and try again.");

  const submittedAt = cleanString(body.submittedAt, 30);
  if (!submittedAt || Number.isNaN(Date.parse(submittedAt))) return invalid("Invalid submission time.");

  const memberName = typeof body.memberName === "string"
    ? body.memberName.replace(/[\u0000-\u001F\u007F]/g, "").trim() : "";
  if (!memberName || memberName.length > 120) return invalid("Please enter your name (up to 120 characters).");

  const classAttendance = cleanClassAttendance(body.classAttendance, classSchedule);
  if (!classAttendance) return invalid("Invalid current-schedule answers.");
  const proposedAttendance = cleanClassAttendance(body.proposedAttendance, proposedClassSchedule);
  if (!proposedAttendance) return invalid("Invalid proposed-schedule answers.");

  const barriers = cleanEnumArray(body.barriers, allowedValues.barriers, 8, true);
  if (!barriers) return invalid("One or more barriers are invalid.");
  if (barriers.includes("none") && barriers.length > 1) return invalid("No consistent barrier cannot be combined with another barrier.");

  const comments = cleanString(body.comments, 1000);
  const email = cleanString(body.email, 254).toLowerCase();
  const contactConsent = body.contactConsent === true;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("Enter a valid email address.");
  if (email && !contactConsent) return invalid("Consent is required when an email is provided.");
  if (!email && contactConsent) return invalid("Contact consent requires an email address.");
  if (options.requireTurnstile && !cleanString(body.turnstileToken, 2048)) return invalid("Complete the verification check.");

  return { ok: true, value: {
    responseId, surveyVersion, submittedAt: new Date(submittedAt).toISOString(), memberName,
    classAttendance, proposedAttendance, barriers, comments, email, contactConsent
  } };
}

function cleanClassAttendance(value, schedule) {
  if (!Array.isArray(value) || value.length !== schedule.size) return null;
  const seen = new Set();
  const byId = new Map();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const classId = cleanString(item.classId, 16);
    const status = item.status == null || item.status === "" ? "never" : cleanString(item.status, 12);
    const scheduledClass = schedule.get(classId);
    if (!scheduledClass || seen.has(classId) || !allowedValues.classAttendanceStatus.has(status)) return null;
    seen.add(classId);
    byId.set(classId, { classId, ...scheduledClass, status });
  }
  // Canonical order keeps repeated submissions comparable even if the input order changes.
  return [...schedule.keys()].map((id) => byId.get(id));
}

function cleanEnumArray(value, allowed, max, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > max) return null;
  const cleaned = [...new Set(value.map((item) => cleanString(item, 32)))];
  if (!allowEmpty && cleaned.length === 0) return null;
  if (cleaned.some((item) => !allowed.has(item))) return null;
  return cleaned.sort();
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function invalid(message) { return { ok: false, message }; }
