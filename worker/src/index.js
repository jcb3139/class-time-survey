import { proposedSchedule } from "../../site/proposed-schedule.js";

const MAX_BODY_BYTES = 16_384;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const allowedValues = {
  classAttendanceStatus: new Set(["regular", "sometimes", "rarely", "never"]),
  barriers: new Set([
    "work",
    "school",
    "childcare",
    "commute",
    "class-full",
    "recovery",
    "none",
    "other"
  ])
};

const classSchedule = new Map(
  [
    ["mon-0515", "Monday", "5:15 AM"],
    ["mon-0630", "Monday", "6:30 AM"],
    ["mon-0745", "Monday", "7:45 AM"],
    ["mon-1200", "Monday", "12:00 PM"],
    ["mon-1715", "Monday", "5:15 PM"],
    ["mon-1830", "Monday", "6:30 PM"],
    ["tue-0515", "Tuesday", "5:15 AM"],
    ["tue-0630", "Tuesday", "6:30 AM"],
    ["tue-1200", "Tuesday", "12:00 PM"],
    ["tue-1715", "Tuesday", "5:15 PM"],
    ["tue-1830", "Tuesday", "6:30 PM"],
    ["wed-0515", "Wednesday", "5:15 AM"],
    ["wed-0630", "Wednesday", "6:30 AM"],
    ["wed-0745", "Wednesday", "7:45 AM"],
    ["wed-1200", "Wednesday", "12:00 PM"],
    ["wed-1715", "Wednesday", "5:15 PM"],
    ["wed-1830", "Wednesday", "6:30 PM"],
    ["thu-0515", "Thursday", "5:15 AM"],
    ["thu-0630", "Thursday", "6:30 AM"],
    ["thu-1200", "Thursday", "12:00 PM"],
    ["thu-1715", "Thursday", "5:15 PM"],
    ["thu-1830", "Thursday", "6:30 PM"],
    ["fri-0515", "Friday", "5:15 AM"],
    ["fri-0630", "Friday", "6:30 AM"],
    ["fri-1200", "Friday", "12:00 PM"],
    ["fri-1600", "Friday", "4:00 PM"],
    ["fri-1715", "Friday", "5:15 PM"],
    ["sat-0800", "Saturday", "8:00 AM"],
    ["sat-0930", "Saturday", "9:30 AM"],
    ["sun-0830", "Sunday", "8:30 AM"],
    ["sun-0945", "Sunday", "9:45 AM"]
  ].map(([id, day, time]) => [id, { day, time, program: "CrossFit" }])
);

const proposedClassSchedule = new Map(
  proposedSchedule.flatMap((day) =>
    day.classes.map((classItem) => [
      classItem.id,
      { day: day.day, time: classItem.time, program: classItem.program }
    ])
  )
);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = normalizeOrigin(request.headers.get("Origin"));
    const allowedOrigin = normalizeOrigin(env.ALLOWED_ORIGIN);

    if (url.pathname !== "/api/survey") {
      return json({ ok: false, message: "Not found." }, 404, origin, allowedOrigin);
    }

    if (!allowedOrigin || !origin || origin !== allowedOrigin) {
      return json({ ok: false, message: "Origin not allowed." }, 403, "", "");
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, allowedOrigin)
      });
    }

    if (request.method !== "POST") {
      return json({ ok: false, message: "Method not allowed." }, 405, origin, allowedOrigin, {
        Allow: "POST, OPTIONS"
      });
    }

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json(
        { ok: false, message: "Content-Type must be application/json." },
        415,
        origin,
        allowedOrigin
      );
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ ok: false, message: "Request too large." }, 413, origin, allowedOrigin);
    }

    let rawBody;
    let body;
    try {
      rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return json({ ok: false, message: "Request too large." }, 413, origin, allowedOrigin);
      }
      body = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, message: "Invalid JSON." }, 400, origin, allowedOrigin);
    }

    // Quietly accept bot-filled honeypots without storing them.
    if (typeof body.website === "string" && body.website.trim()) {
      return json({ ok: true }, 202, origin, allowedOrigin);
    }

    const validation = validateSubmission(body);
    if (!validation.ok) {
      return json({ ok: false, message: validation.message }, 400, origin, allowedOrigin);
    }

    if (!env.TURNSTILE_SECRET) {
      return json({ ok: false, message: "Verification is not configured." }, 503, origin, allowedOrigin);
    }

    const turnstile = await verifyTurnstile(
      body.turnstileToken,
      validation.value.responseId,
      request.headers.get("CF-Connecting-IP"),
      env.TURNSTILE_SECRET
    );

    if (
      !turnstile.success ||
      turnstile.action !== "class-time-survey" ||
      (env.ALLOWED_HOSTNAME && turnstile.hostname !== env.ALLOWED_HOSTNAME)
    ) {
      return json(
        { ok: false, message: "Verification failed. Refresh the page and try again." },
        400,
        origin,
        allowedOrigin
      );
    }

    const submission = validation.value;
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO survey_responses (
          response_id,
          survey_version,
          client_submitted_at,
          class_attendance_json,
          proposed_attendance_json,
          barriers_json,
          comments,
          contact_email,
          contact_consent,
          member_name
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
        .bind(
          submission.responseId,
          submission.surveyVersion,
          submission.submittedAt,
          JSON.stringify(submission.classAttendance),
          JSON.stringify(submission.proposedAttendance),
          JSON.stringify(submission.barriers),
          submission.comments || null,
          submission.email || null,
          submission.contactConsent ? 1 : 0,
          submission.memberName
        )
        .run();
    } catch (error) {
      console.error("Survey insert failed", error);
      return json(
        { ok: false, message: "We couldn’t save your response. Please try again." },
        500,
        origin,
        allowedOrigin
      );
    }

    return json({ ok: true, responseId: submission.responseId }, 201, origin, allowedOrigin);
  }
};

export function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("Invalid submission.");
  }

  const responseId = cleanString(body.responseId, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(responseId)) {
    return invalid("Invalid response ID.");
  }

  const surveyVersion = cleanString(body.surveyVersion, 24);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(surveyVersion)) {
    return invalid("Invalid survey version.");
  }

  const submittedAt = cleanString(body.submittedAt, 30);
  if (!submittedAt || Number.isNaN(Date.parse(submittedAt))) {
    return invalid("Invalid submission time.");
  }

  const classAttendance = cleanClassAttendance(body.classAttendance, classSchedule);
  const memberName = typeof body.memberName === "string"
    ? body.memberName.replace(/[\u0000-\u001F\u007F]/g, "").trim() : "";
  if (!memberName || memberName.length > 120) return invalid("Please enter your name (up to 120 characters).");
  if (!classAttendance) return invalid("Rate every current class with a valid attendance choice.");

  const proposedAttendance = cleanClassAttendance(body.proposedAttendance, proposedClassSchedule);
  if (!proposedAttendance) return invalid("Rate every proposed class with a valid attendance choice.");

  const barriers = cleanEnumArray(body.barriers, allowedValues.barriers, 8, true);
  if (!barriers) return invalid("One or more barriers are invalid.");
  if (barriers.includes("none") && barriers.length > 1) {
    return invalid("No consistent barrier cannot be combined with another barrier.");
  }

  const comments = cleanString(body.comments, 1000);
  const email = cleanString(body.email, 254).toLowerCase();
  const contactConsent = body.contactConsent === true;
  if (email && !isValidEmail(email)) return invalid("Enter a valid email address.");
  if (email && !contactConsent) return invalid("Consent is required when an email is provided.");
  if (!email && contactConsent) return invalid("Contact consent requires an email address.");

  const turnstileToken = cleanString(body.turnstileToken, 2048);
  if (!turnstileToken) return invalid("Complete the verification check.");

  return {
    ok: true,
    value: {
      responseId,
      surveyVersion,
      submittedAt: new Date(submittedAt).toISOString(),
      memberName,
      classAttendance,
      proposedAttendance,
      barriers,
      comments,
      email,
      contactConsent
    }
  };
}

function cleanClassAttendance(value, schedule) {
  if (!Array.isArray(value) || value.length !== schedule.size) return null;

  const seen = new Set();
  const cleaned = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const classId = cleanString(item.classId, 16);
    const status = cleanString(item.status, 12);
    const scheduledClass = schedule.get(classId);
    if (!scheduledClass || seen.has(classId) || !allowedValues.classAttendanceStatus.has(status)) {
      return null;
    }
    seen.add(classId);
    cleaned.push({ classId, ...scheduledClass, status });
  }

  if (seen.size !== schedule.size) return null;
  return cleaned;
}

async function verifyTurnstile(token, responseId, remoteIp, secret) {
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: remoteIp || undefined,
        idempotency_key: responseId
      })
    });
    if (!response.ok) return { success: false };
    return await response.json();
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return { success: false };
  }
}

function cleanEnumArray(value, allowed, max, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > max) return null;
  const cleaned = [...new Set(value.map((item) => cleanString(item, 32)))];
  if (!allowEmpty && cleaned.length === 0) return null;
  if (cleaned.some((item) => !allowed.has(item))) return null;
  return cleaned;
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function invalid(message) {
  return { ok: false, message };
}

function normalizeOrigin(value) {
  return typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Accept";
    headers.Vary = "Origin";
  }
  return headers;
}

function json(body, status, origin, allowedOrigin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, allowedOrigin), ...extraHeaders }
  });
}
