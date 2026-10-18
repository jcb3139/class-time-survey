import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";
import { createAppsScriptBundle } from "../scripts/build-apps-script.mjs";
import { currentSchedule } from "../site/schedule.js";
import { proposedSchedule } from "../site/proposed-schedule.js";

const source = await createAppsScriptBundle();
const responseId = "726e3f8a-942d-45da-ae10-62f36810b042";
function payload() {
  const answers = (schedule) => schedule.flatMap((day) => day.classes.map((item) => ({ classId: item.id, status: "never" })));
  return { responseId, surveyVersion: "2026-10-18", submittedAt: "2026-10-18T17:00:00Z",
    memberName: "Jordan Smith",
    classAttendance: answers(currentSchedule), proposedAttendance: answers(proposedSchedule),
    barriers: [], comments: "", email: "", contactConsent: false };
}

function harness() {
  const state = { activeEmail: "owner@example.com", effectiveEmail: "owner@example.com", failNextFlush: false, locked: false };
  const properties = new Map([["ALLOWED_ORIGINS", "https://example.github.io,http://127.0.0.1:4173"]]);
  class Range {
    constructor(sheet, row, column, rows = 1, columns = 1) { Object.assign(this, { sheet, row, column, rows, columns }); }
    getRow() { return this.row; }
    getValues() {
      return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.columns }, (_, c) => this.sheet.data[this.row - 1 + r]?.[this.column - 1 + c] ?? ""));
    }
    setValues(values) {
      assert.equal(state.locked, true, "sheet mutations must hold the script lock");
      values.forEach((row, r) => row.forEach((value, c) => {
        this.sheet.data[this.row - 1 + r] ||= [];
        this.sheet.data[this.row - 1 + r][this.column - 1 + c] = value;
      }));
      return this;
    }
    setValue(value) { return this.setValues([[value]]); }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
    createTextFinder(text) {
      const range = this;
      return { matchEntireCell() { return this; }, findNext() {
        const index = range.getValues().findIndex((row) => row[0] === text);
        return index < 0 ? null : new Range(range.sheet, range.row + index, range.column);
      } };
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; }
    setName(name) { this.name = name; return this; }
    getLastRow() { return this.data.length; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after, count) { this.maxRows += count; }
    getRange(...args) { return new Range(this, ...args); }
    setFrozenRows() {}
  }
  const book = {
    sheets: [new Sheet("Sheet1")],
    getId() { return "private-sheet-id"; },
    getUrl() { return "https://docs.google.com/spreadsheets/d/private-sheet-id/edit"; },
    getSheets() { return this.sheets; },
    getSheetByName(name) { return this.sheets.find((sheet) => sheet.name === name); },
    insertSheet(name) { const sheet = new Sheet(name); this.sheets.push(sheet); return sheet; }
  };
  const output = (html) => ({ html, setXFrameOptionsMode() { return this; }, setMimeType() { return this; } });
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Session: { getActiveUser: () => ({ getEmail: () => state.activeEmail }), getEffectiveUser: () => ({ getEmail: () => state.effectiveEmail }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key), setProperty: (key, value) => properties.set(key, value) }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(state.locked, false); state.locked = true; }, releaseLock() { state.locked = false; } }) },
    SpreadsheetApp: { create: () => book, openById: () => book, flush() {
      if (state.failNextFlush) { state.failNextFlush = false; throw new Error("Simulated Google service failure"); }
    } },
    Utilities: { newBlob: (value) => ({ getBytes: () => [...Buffer.from(value)] }),
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_, text) => [...createHash("sha256").update(text).digest()] },
    HtmlService: { createHtmlOutput: output, XFrameOptionsMode: { ALLOWALL: "ALLOWALL" } },
    ContentService: { createTextOutput: output, MimeType: { JSON: "application/json" } }
  });
  vm.runInContext(source, context);
  function send(body = payload(), changes = {}) {
    const result = context.doPost({ parameter: { payload: JSON.stringify(body), responseId: body.responseId,
      receiptNonce: "93c4677c-12ab-4ae1-8387-a8394679c195", returnOrigin: "https://example.github.io", ...changes } });
    const match = result.html.match(/window\.top\.postMessage\((.*), "https:\/\/example.github.io"\);/);
    return { html: result.html, receipt: match ? JSON.parse(match[1]) : null };
  }
  context.setup();
  return { context, book, properties, state, send };
}

test("Google backend saves one response and 75 normalized class answers before acknowledging", () => {
  const h = harness();
  const { receipt, html } = h.send();
  assert.equal(receipt.ok, true);
  assert.equal(receipt.responseId, responseId);
  assert.equal(h.book.getSheetByName("Responses").getLastRow(), 2);
  assert.equal(h.book.getSheetByName("Responses").data[1][10], "saved");
  assert.equal(h.book.getSheetByName("Responses").data[1][11], "Jordan Smith");
  assert.equal(JSON.parse(h.book.getSheetByName("Responses").data[1][8]).memberName, "Jordan Smith");
  const rows = h.book.getSheetByName("Attendance").data.slice(1);
  assert.equal(rows.length, 75);
  assert.equal(rows.filter((row) => row[1] === "current").length, 31);
  assert.equal(rows.filter((row) => row[1] === "proposed").length, 44);
  assert.ok(rows.every((row) => row[6] === "never"));
  assert.ok(rows.every((row) => row[8] === "Jordan Smith"));
  assert.doesNotMatch(html, /private-sheet-id|contact_email|raw_json|Jordan Smith/);
  assert.equal(h.state.locked, false);
});

test("retries are idempotent and cannot modify previously saved answers", () => {
  const h = harness();
  assert.equal(h.send().receipt.ok, true);
  const retry = payload();
  retry.submittedAt = "2026-10-18T18:00:00Z";
  retry.classAttendance.reverse();
  assert.equal(h.send(retry).receipt.ok, true);
  const renamed = payload();
  renamed.memberName = "Another Member";
  assert.equal(h.send(renamed).receipt.ok, false);
  retry.classAttendance[0].status = "regular";
  assert.equal(h.send(retry).receipt.ok, false);
  assert.equal(h.book.getSheetByName("Responses").getLastRow(), 2);
  assert.equal(h.book.getSheetByName("Attendance").getLastRow(), 76);
  assert.ok(h.book.getSheetByName("Attendance").data.slice(1).every((row) => row[6] === "never"));
});

test("Google receiver rejects missing or blank names before storing any answers", () => {
  const h = harness();
  for (const memberName of [undefined, null, 123, "", "   ", "\t\n", "\u0000", "x".repeat(121)]) {
    assert.equal(h.send({ ...payload(), memberName }).receipt.ok, false);
  }
  assert.equal(h.book.getSheetByName("Responses").getLastRow(), 1);
  assert.equal(h.book.getSheetByName("Attendance").getLastRow(), 1);
  const body = { ...payload(), memberName: "  李明  " };
  assert.equal(h.send(body).receipt.ok, true);
  assert.equal(h.book.getSheetByName("Responses").data[1][11], "李明");
  assert.ok(h.book.getSheetByName("Attendance").data.slice(1).every((row) => row[8] === "李明"));
});

test("existing sheets gain name headers without modifying historical responses", () => {
  const h = harness();
  assert.equal(h.send().receipt.ok, true);
  for (const sheet of h.book.sheets) {
    sheet.data.forEach((row) => row.pop());
  }
  const historical = h.book.sheets.map((sheet) => structuredClone(sheet.data.slice(1)));
  h.context.setup();
  h.book.sheets.forEach((sheet, index) => {
    assert.equal(sheet.data[0].at(-1), "member_name");
    assert.deepEqual(sheet.data.slice(1), historical[index]);
  });
  const body = { ...payload(), responseId: "826e3f8a-942d-45da-ae10-62f36810b042", memberName: "New Member" };
  assert.equal(h.send(body).receipt.ok, true);
  assert.equal(h.book.getSheetByName("Responses").data.at(-1)[11], "New Member");
  assert.ok(h.book.getSheetByName("Attendance").data.slice(-75).every((row) => row[8] === "New Member"));
});

test("an interrupted save is repaired on retry without duplicating attendance rows", () => {
  const h = harness();
  h.state.failNextFlush = true;
  assert.equal(h.send().receipt.ok, false);
  assert.equal(h.book.getSheetByName("Responses").data[1][10], "pending");
  assert.equal(h.book.getSheetByName("Attendance").getLastRow(), 76);
  assert.equal(h.send().receipt.ok, true);
  assert.equal(h.book.getSheetByName("Responses").data[1][10], "saved");
  assert.equal(h.book.getSheetByName("Attendance").getLastRow(), 76);
});

test("formula-like comments stay text and invalid answers never reach storage", () => {
  const h = harness();
  const body = payload();
  body.comments = '=HYPERLINK("https://example.com","test")';
  assert.equal(h.send(body).receipt.ok, true);
  assert.ok(h.book.getSheetByName("Responses").data[1][5].startsWith("'="));
  const invalid = payload();
  invalid.proposedAttendance[0].status = "bad";
  assert.equal(h.send(invalid).receipt.ok, false);
  assert.equal(h.book.getSheetByName("Responses").getLastRow(), 2);
});

test("anonymous callers cannot run setup or read results via the health endpoint", () => {
  const h = harness();
  h.state.activeEmail = "";
  assert.throws(() => h.context.setup(), /script owner/);
  assert.deepEqual(JSON.parse(h.context.doGet().html), { ok: true, service: "cfb-survey-receiver" });
  const { receipt } = h.send(payload(), { returnOrigin: "https://unconfigured.example" });
  assert.equal(receipt, null);
  assert.equal(h.book.getSheetByName("Responses").getLastRow(), 1);
});
