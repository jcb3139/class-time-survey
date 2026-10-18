// Deploy the generated Code.gs, not this source file by itself.
const RESPONSE_HEADERS = [
  'response_id', 'received_at', 'survey_version', 'submitted_at', 'barriers',
  'comments', 'contact_email', 'contact_consent', 'raw_json', 'fingerprint', 'save_status', 'member_name'
];
const ATTENDANCE_HEADERS = [
  'response_id', 'schedule', 'class_id', 'day', 'time', 'program', 'attendance', 'received_at', 'member_name'
];

// Run in the Apps Script editor once to create the private response spreadsheet.
// Public web-app visitors must never be able to run setup as the deployment owner.
function setup() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run setup while signed in as the script owner in the Apps Script editor.');
  }
  const properties = PropertiesService.getScriptProperties();
  if (!allowedOrigins_().length) throw new Error('Set the ALLOWED_ORIGINS Script Property before running setup.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let id = properties.getProperty('SPREADSHEET_ID');
    let spreadsheet;
    if (id) spreadsheet = SpreadsheetApp.openById(id);
    else {
      spreadsheet = SpreadsheetApp.create('CrossFit Bethesda Survey Responses');
      id = spreadsheet.getId();
      properties.setProperty('SPREADSHEET_ID', id);
      spreadsheet.getSheets()[0].setName('Responses');
    }
    ensureSheet_(spreadsheet, 'Responses', RESPONSE_HEADERS);
    ensureSheet_(spreadsheet, 'Attendance', ATTENDANCE_HEADERS);
    SpreadsheetApp.flush();
    console.log('Response spreadsheet: ' + spreadsheet.getUrl());
    return spreadsheet.getUrl();
  } finally { lock.releaseLock(); }
}

// Health check only. There is no public API for reading results or editing them.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'cfb-survey-receiver' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  const parameters = event && event.parameter || {};
  const origin = String(parameters.returnOrigin || '');
  const nonce = String(parameters.receiptNonce || '');
  const responseId = String(parameters.responseId || '');
  if (!allowedOrigins_().includes(origin)) {
    return HtmlService.createHtmlOutput('This survey is not configured for this website.');
  }
  const receipt = { channel: 'cfb-survey-receipt', nonce: nonce, responseId: responseId, ok: false };
  try {
    if (!/^[a-f0-9-]{36}$/i.test(nonce)) throw new Error('Invalid receipt.');
    const raw = String(parameters.payload || '');
    if (!raw || Utilities.newBlob(raw).getBytes().length > 16384) {
      receipt.message = 'The response is too large. Please shorten your comment and try again.';
      return receipt_(receipt, origin);
    }
    let body;
    try { body = JSON.parse(raw); }
    catch (error) {
      receipt.message = 'The response could not be read. Refresh the page and try again.';
      return receipt_(receipt, origin);
    }
    if (body.website) {
      receipt.message = 'This response could not be accepted.';
      return receipt_(receipt, origin);
    }
    const validation = validateSurveySubmission(body);
    if (!validation.ok || validation.value.responseId !== responseId) {
      receipt.message = validation.message || 'Invalid response ID.';
      return receipt_(receipt, origin);
    }
    receipt.ok = storeResponse_(validation.value);
  } catch (error) {
    console.error('Survey storage failed: ' + error.message);
    receipt.message = error.message === 'This response was already saved with different answers.'
      ? 'This response was already saved. Reload the survey to send a new response.'
      : 'We couldn’t save your response. Please try again.';
  }
  return receipt_(receipt, origin);
}

function storeResponse_(submission) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup before accepting responses.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const spreadsheet = SpreadsheetApp.openById(id);
    const responses = ensureSheet_(spreadsheet, 'Responses', RESPONSE_HEADERS);
    const attendance = ensureSheet_(spreadsheet, 'Attendance', ATTENDANCE_HEADERS);
    const content = Object.assign({}, submission);
    delete content.submittedAt; // A retry may have a new client send time.
    const fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(content), Utilities.Charset.UTF_8).map(function(byte) {
        return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
      }).join('');

    let row = 0;
    if (responses.getLastRow() > 1) {
      const match = responses.getRange(2, 1, responses.getLastRow() - 1, 1)
        .createTextFinder(submission.responseId).matchEntireCell(true).findNext();
      if (match) row = match.getRow();
    }
    let receivedAt = new Date().toISOString();
    if (row) {
      const saved = responses.getRange(row, 1, 1, RESPONSE_HEADERS.length).getValues()[0];
      if (saved[9] !== fingerprint) throw new Error('This response was already saved with different answers.');
      if (saved[10] === 'saved') return true;
      receivedAt = saved[1];
    } else {
      row = appendRows_(responses, [[submission.responseId, receivedAt, submission.surveyVersion,
        submission.submittedAt, submission.barriers.join(', '), submission.comments, submission.email,
        submission.contactConsent, JSON.stringify(submission), fingerprint, 'pending', submission.memberName]]);
    }

    // Keep the original payload in Responses. If a service error interrupts the
    // normalized Attendance write, a retry appends only the still-missing rows.
    const desired = [];
    [['current', submission.classAttendance], ['proposed', submission.proposedAttendance]].forEach(function(group) {
      group[1].forEach(function(answer) {
        desired.push([submission.responseId, group[0], answer.classId, answer.day,
          answer.time, answer.program, answer.status, receivedAt, submission.memberName]);
      });
    });
    const existing = new Map();
    if (attendance.getLastRow() > 1) {
      attendance.getRange(2, 1, attendance.getLastRow() - 1, ATTENDANCE_HEADERS.length)
        .getValues().forEach(function(values) {
          if (values[0] !== submission.responseId) return;
          const key = values[1] + '|' + values[2];
          if (existing.has(key)) throw new Error('Duplicate attendance rows need owner review.');
          existing.set(key, values);
        });
    }
    const missing = desired.filter(function(values) {
      const previous = existing.get(values[1] + '|' + values[2]);
      if (!previous) return true;
      if (JSON.stringify(previous.slice(0, 7)) !== JSON.stringify(values.slice(0, 7))) {
        throw new Error('Stored attendance differs from the original response.');
      }
      return false;
    });
    if (missing.length) appendRows_(attendance, missing);
    SpreadsheetApp.flush();
    responses.getRange(row, 11).setValue('saved');
    SpreadsheetApp.flush();
    return true;
  } finally { lock.releaseLock(); }
}

function allowedOrigins_() {
  return String(PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS') || '')
    .split(',').map(function(value) { return value.trim(); })
    .filter(function(value) { return /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value); });
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    // Upgrade the previous schema by adding a column, never rewriting historical responses.
    if (headers[headers.length - 1] === 'member_name' && existing[headers.length - 1] === '' &&
        JSON.stringify(existing.slice(0, -1)) === JSON.stringify(headers.slice(0, -1))) {
      sheet.getRange(1, headers.length).setValue('member_name').setFontWeight('bold');
    } else if (JSON.stringify(existing) !== JSON.stringify(headers)) {
      throw new Error(name + ' has unexpected headers.');
    }
  }
  return sheet;
}

function appendRows_(sheet, rows) {
  const first = sheet.getLastRow() + 1;
  const last = first + rows.length - 1;
  if (last > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), last - sheet.getMaxRows());
  sheet.getRange(first, 1, rows.length, rows[0].length).setNumberFormat('@')
    .setValues(rows.map(function(values) { return values.map(safeCell_); }));
  return first;
}

function safeCell_(value) {
  // User names and comments must stay text, including when exporting to Excel/CSV.
  return typeof value === 'string' && /^\s*[=+@-]/.test(value) ? "'" + value : value;
}

function receipt_(receipt, origin) {
  const data = JSON.stringify(receipt).replace(/</g, '\\u003c');
  const target = JSON.stringify(origin).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><html><body><script>' +
    'window.top.postMessage(' + data + ', ' + target + ');' +
    '</script></body></html>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
