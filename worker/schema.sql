CREATE TABLE IF NOT EXISTS survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id TEXT NOT NULL UNIQUE,
  survey_version TEXT NOT NULL,
  client_submitted_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  class_attendance_json TEXT NOT NULL,
  proposed_attendance_json TEXT NOT NULL,
  barriers_json TEXT NOT NULL DEFAULT '[]',
  comments TEXT,
  contact_email TEXT,
  contact_consent INTEGER NOT NULL DEFAULT 0 CHECK (contact_consent IN (0, 1)),
  member_name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS survey_responses_received_at_idx
  ON survey_responses(received_at);

