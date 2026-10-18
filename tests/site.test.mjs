import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { proposedSchedule } from "../site/proposed-schedule.js";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../site/survey.js", import.meta.url), "utf8");
const schedule = await readFile(new URL("../site/schedule.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
const { validateSubmission } = await import("../worker/src/index.js");

function validSubmission(overrides = {}) {
  return {
    responseId: "726e3f8a-942d-45da-ae10-62f36810b042",
    surveyVersion: "2026-10-18",
    submittedAt: "2026-08-31T17:00:00.000Z",
    memberName: "Jordan Smith",
    classAttendance: [...schedule.matchAll(/id: "([a-z]{3}-\d{4})"/g)].map((match) => ({
      classId: match[1],
      status: "never"
    })),
    proposedAttendance: proposedSchedule.flatMap((day) =>
      day.classes.map((classItem) => ({ classId: classItem.id, status: "never" }))
    ),
    barriers: ["work"],
    comments: "A short comment.",
    email: "",
    contactConsent: false,
    turnstileToken: "test-token",
    ...overrides
  };
}

test("survey exposes the required planning questions", () => {
  assert.match(html, /id="proposedCalendar"/);
  assert.match(html, /type="module"/);
  assert.equal([...schedule.matchAll(/id: "([a-z]{3}-\d{4})"/g)].length, 31);
  for (const status of ["regular", "sometimes", "rarely", "never"]) {
    assert.match(script, new RegExp(`value: ["']${status}["']`));
  }
});

test("survey does not use browser storage for responses", () => {
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
});

test("static frontend contains no backend secret", () => {
  assert.doesNotMatch(html + script, /TURNSTILE_SECRET|api[_-]?key\s*[:=]/i);
});

test("worker validates origin, Turnstile, and uses a prepared D1 statement", () => {
  assert.match(worker, /ALLOWED_ORIGIN/);
  assert.match(worker, /siteverify/);
  assert.match(worker, /\.prepare\(/);
  assert.match(worker, /\.bind\(/);
});

test("worker accepts a well-formed named response without email", () => {
  assert.equal(validateSubmission(validSubmission()).ok, true);
});

test("worker requires a name and preserves Unicode and single-word names", () => {
  for (const memberName of [undefined, null, 123, "", "   ", "\t\n", "\u0000", "x".repeat(121)]) {
    assert.equal(validateSubmission(validSubmission({ memberName })).ok, false);
  }
  for (const memberName of ["  Zoë O’Neill  ", "李明", "Prince"]) {
    const result = validateSubmission(validSubmission({ memberName }));
    assert.equal(result.ok, true);
    assert.equal(result.value.memberName, memberName.trim());
  }
  assert.match(html, /id="memberName"[^>]*required/);
  assert.doesNotMatch(html, /keep your response anonymous/);
});

test("proposed schedule preserves the workbook's CrossFit times, including Friday overrides", () => {
  const earlyWeek = ["5:00 AM", "6:15 AM", "7:30 AM", "9:00 AM", "12:00 PM", "4:00 PM", "5:15 PM", "6:30 PM"];
  const expected = [
    ["Monday", earlyWeek],
    ["Tuesday", earlyWeek],
    ["Wednesday", earlyWeek],
    ["Thursday", earlyWeek],
    ["Friday", ["5:00 AM", "6:15 AM", "7:30 AM", "9:00 AM", "12:00 PM", "3:00 PM", "4:15 PM", "5:30 PM"]],
    ["Saturday", ["8:00 AM", "9:30 AM"]],
    ["Sunday", ["8:30 AM", "9:45 AM"]]
  ];
  assert.deepEqual(proposedSchedule.map((day) => [day.day, day.classes.map((item) => item.time)]), expected);
  assert.equal(proposedSchedule.flatMap((day) => day.classes).length, 44);
  assert.ok(proposedSchedule.every((day) => day.classes.every((item) => item.program === "CrossFit")));
});

test("worker requires one valid attendance status for every scheduled class", () => {
  const incomplete = validSubmission();
  incomplete.classAttendance.pop();
  assert.equal(validateSubmission(incomplete).ok, false);

  const invalidStatus = validSubmission();
  invalidStatus.classAttendance[0].status = "often";
  assert.equal(validateSubmission(invalidStatus).ok, false);
});

test("worker requires a complete proposed schedule with unique valid class IDs", () => {
  assert.equal(validateSubmission(validSubmission({ proposedAttendance: undefined })).ok, false);
  for (const change of [
    (items) => items.pop(),
    (items) => { items[1] = items[0]; },
    (items) => { items[0].classId = "mon-0515"; },
    (items) => { items[0].status = "often"; }
  ]) {
    const submission = validSubmission();
    change(submission.proposedAttendance);
    assert.equal(validateSubmission(submission).ok, false);
  }
});

test("current and proposed answers stay independent even for unchanged class times", () => {
  const submission = validSubmission();
  submission.classAttendance.find((item) => item.classId === "mon-1200").status = "regular";
  const proposed = submission.proposedAttendance.find((item) => item.classId === "mon-1200");
  proposed.status = "sometimes";
  proposed.time = "9:00 PM";
  const result = validateSubmission(submission);
  assert.equal(result.ok, true);
  assert.equal(result.value.classAttendance.find((item) => item.classId === "mon-1200").status, "regular");
  const saved = result.value.proposedAttendance.find((item) => item.classId === "mon-1200");
  assert.equal(saved.status, "sometimes");
  assert.equal(saved.time, "12:00 PM");
});

test("worker requires consent when an email is included", () => {
  const result = validateSubmission(
    validSubmission({ email: "member@example.com", contactConsent: false })
  );
  assert.equal(result.ok, false);
});
