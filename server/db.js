'use strict';
/**
 * Database layer (SQLite via node:sqlite).
 *
 * Privacy design — the most important rule in this file:
 *   Student master data (students, completions) and anonymous feedback
 *   (feedback, feedback_answers) are deliberately NOT linked.
 *     - `completions` only records THAT a student finished a given
 *       faculty-subject form in a cycle (used for eligibility + tracking).
 *     - `feedback` stores the ratings with academic context only.
 *     - Both store a calendar date, never a precise timestamp, and feedback
 *       rows use random ids in a WITHOUT ROWID table, so neither insertion
 *       order nor time can be used to join a response back to a student.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id     INTEGER PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name   TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classes (
  id            INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  year          INTEGER NOT NULL CHECK (year BETWEEN 1 AND 5),
  semester      INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 10),
  section       TEXT NOT NULL COLLATE NOCASE,
  active        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (department_id, year, semester, section)
);

CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY,
  register_no    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  department_id  INTEGER NOT NULL REFERENCES departments(id),
  class_id       INTEGER REFERENCES classes(id),
  admission_year INTEGER,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','graduated'))
);

CREATE TABLE IF NOT EXISTS faculty (
  id            INTEGER PRIMARY KEY,
  staff_id      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  designation   TEXT,
  email         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  semester      INTEGER,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mappings (
  id         INTEGER PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  faculty_id INTEGER NOT NULL REFERENCES faculty(id),
  UNIQUE (class_id, subject_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS cycles (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  term          TEXT NOT NULL CHECK (term IN ('Odd','Even')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  opens_on      TEXT,
  closes_on     TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id       INTEGER PRIMARY KEY,
  position INTEGER NOT NULL,
  text     TEXT NOT NULL,
  short    TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

-- ANONYMOUS: no student reference of any kind.
CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES cycles(id),
  mapping_id    INTEGER REFERENCES mappings(id) ON DELETE SET NULL,
  faculty_id    INTEGER NOT NULL REFERENCES faculty(id),
  subject_id    INTEGER NOT NULL REFERENCES subjects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  year          INTEGER NOT NULL,
  semester      INTEGER NOT NULL,
  section       TEXT NOT NULL,
  average       REAL NOT NULL,
  comment       TEXT,
  submitted_on  TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS feedback_answers (
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  rating      REAL NOT NULL CHECK (rating >= 1 AND rating <= 10),
  PRIMARY KEY (feedback_id, question_id)
) WITHOUT ROWID;

-- IDENTIFIED, but contains no answers. Eligibility + completion tracking only.
CREATE TABLE IF NOT EXISTS completions (
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  cycle_id     INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  mapping_id   INTEGER NOT NULL REFERENCES mappings(id) ON DELETE CASCADE,
  completed_on TEXT NOT NULL,
  PRIMARY KEY (student_id, cycle_id, mapping_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','dept_admin')),
  department_id INTEGER REFERENCES departments(id),
  active        INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Faculty portal sessions (separate from admin sessions).
CREATE TABLE IF NOT EXISTS faculty_sessions (
  token_hash TEXT PRIMARY KEY,
  faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_logs (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,
  mode       TEXT NOT NULL,
  filename   TEXT,
  total      INTEGER NOT NULL,
  added      INTEGER NOT NULL,
  updated    INTEGER NOT NULL,
  failed     INTEGER NOT NULL,
  admin      TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_feedback_cycle   ON feedback(cycle_id, department_id);
CREATE INDEX IF NOT EXISTS ix_feedback_faculty ON feedback(faculty_id);
CREATE INDEX IF NOT EXISTS ix_students_class   ON students(class_id);
CREATE INDEX IF NOT EXISTS ix_mappings_class   ON mappings(class_id);
`;

/** Adds columns introduced after the first release to existing databases. */
function migrate(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const add = (t, col, def) => { if (!cols(t).includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  add('students', 'dob', 'TEXT');
  add('faculty', 'password_hash', 'TEXT');
  add('faculty', 'must_change_password', 'INTEGER NOT NULL DEFAULT 1');
  add('faculty', 'last_login', 'TEXT');
}

/** Normalises a date of birth to YYYY-MM-DD. Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, Date. */
function normalizeDob(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let y, m, d;
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (mt) [, y, m, d] = mt;
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = mt;
  else return undefined;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return undefined;
  if (+y < 1940 || dt > new Date()) return undefined;
  return dt.toISOString().slice(0, 10);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  /** Run fn inside a transaction; rolls back on throw. */
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  migrate(db);
  db.all = (sql, ...p) => db.prepare(sql).all(...p);
  db.get = (sql, ...p) => db.prepare(sql).get(...p);
  db.run = (sql, ...p) => db.prepare(sql).run(...p);

  db.getSetting = (key, fallback = null) => {
    const row = db.get('SELECT value FROM settings WHERE key = ?', key);
    return row ? row.value : fallback;
  };
  db.setSetting = (key, value) =>
    db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));

  if (!db.getSetting('secret')) db.setSetting('secret', crypto.randomBytes(32).toString('hex'));
  return db;
}

module.exports = { open, hashPassword, verifyPassword, today, normalizeDob };
