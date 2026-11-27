'use strict';
/**
 * Imports the CSV data of the previous Flask/CSV feedback system
 * (github.com/JaiSamyukth/Feedback-System) into this application.
 *
 *   node server/import-legacy.js /path/to/old/feedback-system
 *
 * Reads (each file optional): departments.csv, staffs.csv, subjects.csv,
 * students.csv, admin_mapping.csv, ratings.csv. Old ratings are imported as
 * anonymous feedback into a closed "Legacy import" cycle — the stored (hashed)
 * register numbers are discarded. Running it twice does not create duplicates
 * for departments, staff, subjects, classes, students or mappings.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('./importer');

function readCsv(file) {
  if (!fs.existsSync(file)) return null;
  let buf = fs.readFileSync(file);
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim()));
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).replace(/[\u00a0\ufeff]/g, '').trim().toLowerCase());
  // Collapse non-breaking spaces / stray whitespace (the old files contain some).
  const clean = (v) => String(v ?? '').replace(/[\u00a0\u200b\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [clean(h), clean(r[i])])));
}

const semNum = (s) => Number(String(s).replace(/semester/i, '').trim()) || null;
const codeFromName = (name) => name.split(/\s+/).filter((w) => !/^(and|of|&)$/i.test(w)).map((w) => w[0]).join('').toUpperCase().slice(0, 8);

function importLegacy(db, dir, log = console.log) {
  const files = {
    departments: readCsv(path.join(dir, 'departments.csv')),
    staffs: readCsv(path.join(dir, 'staffs.csv')),
    subjects: readCsv(path.join(dir, 'subjects.csv')),
    students: readCsv(path.join(dir, 'students.csv')),
    mapping: readCsv(path.join(dir, 'admin_mapping.csv')),
    ratings: readCsv(path.join(dir, 'ratings.csv')),
  };
  const stats = { departments: 0, faculty: 0, subjects: 0, classes: 0, students: 0, mappings: 0, feedback: 0, skipped: 0 };

  return db.tx(() => {
    /* departments: match by full name, else create */
    const deptByName = new Map(db.all('SELECT id, code, name FROM departments').map((d) => [d.name.toLowerCase(), d]));
    const dept = (name) => {
      name = String(name || '').trim();
      if (!name) return null;
      const hit = deptByName.get(name.toLowerCase()) || db.get('SELECT id, code, name FROM departments WHERE code = ?', name.toUpperCase());
      if (hit) return hit.id;
      let code = codeFromName(name) || 'DEPT';
      for (let i = 2; db.get('SELECT 1 FROM departments WHERE code = ?', code); i++) code = codeFromName(name).slice(0, 6) + i;
      const id = Number(db.run('INSERT INTO departments(code, name) VALUES(?,?)', code, name).lastInsertRowid);
      deptByName.set(name.toLowerCase(), { id, code, name });
      stats.departments++;
      return id;
    };
    for (const r of files.departments || []) dept(r.department);

    let general = null;
    const generalDept = () => {
      if (general) return general;
      const hit = db.get("SELECT id FROM departments WHERE code = 'GEN'");
      if (hit) return (general = hit.id);
      stats.departments++;
      return (general = Number(db.run("INSERT INTO departments(code, name) VALUES('GEN', 'General / Unassigned')").lastInsertRowid));
    };

    /* department & semester hints for staff and subjects come from the mapping file */
    const staffDept = new Map();
    const subjectHint = new Map();
    for (const m of files.mapping || []) {
      const d = dept(m.department);
      if (m.staff && !staffDept.has(m.staff.toLowerCase())) staffDept.set(m.staff.toLowerCase(), d);
      if (m.subject && !subjectHint.has(m.subject.toLowerCase())) subjectHint.set(m.subject.toLowerCase(), { d, sem: semNum(m.semester) });
    }

    /* faculty: staff names only in the old system → generate Staff IDs */
    const facultyId = (name) => {
      name = String(name || '').trim();
      if (!name) return null;
      const hit = db.get('SELECT id FROM faculty WHERE lower(name) = lower(?)', name);
      if (hit) return hit.id;
      let n = db.get("SELECT COUNT(*) n FROM faculty WHERE staff_id LIKE 'STF%'").n + 1;
      let sid;
      do sid = `STF${String(n++).padStart(3, '0')}`; while (db.get('SELECT 1 FROM faculty WHERE staff_id = ?', sid));
      stats.faculty++;
      return Number(db.run('INSERT INTO faculty(staff_id, name, department_id, designation) VALUES(?,?,?,?)', sid, name, staffDept.get(name.toLowerCase()) || generalDept(), null).lastInsertRowid);
    };
    for (const r of files.staffs || []) facultyId(r.staff);

    /* subjects: names only → generate codes */
    const subjectId = (name, hintDept, hintSem) => {
      name = String(name || '').trim();
      if (!name) return null;
      const h = subjectHint.get(name.toLowerCase());
      const d = hintDept || h?.d || generalDept();
      const hit = db.get('SELECT id FROM subjects WHERE lower(name) = lower(?) AND department_id = ?', name, d) || (!hintDept && db.get('SELECT id FROM subjects WHERE lower(name) = lower(?)', name));
      if (hit) return hit.id;
      let n = db.get("SELECT COUNT(*) n FROM subjects WHERE code LIKE 'SUB%'").n + 1;
      let code;
      do code = `SUB${String(n++).padStart(3, '0')}`; while (db.get('SELECT 1 FROM subjects WHERE code = ?', code));
      stats.subjects++;
      return Number(db.run('INSERT INTO subjects(code, name, department_id, semester) VALUES(?,?,?,?)', code, name, d, hintSem || h?.sem || null).lastInsertRowid);
    };
    for (const r of files.subjects || []) subjectId(r.subject);

    /* classes: the old system had department + semester only → section A */
    const classId = (d, sem) => {
      if (!d || !sem) return null;
      const year = Math.ceil(sem / 2);
      const hit = db.get("SELECT id FROM classes WHERE department_id = ? AND year = ? AND semester = ? AND section = 'A'", d, year, sem);
      if (hit) return hit.id;
      stats.classes++;
      return Number(db.run("INSERT INTO classes(department_id, year, semester, section) VALUES(?,?,?, 'A')", d, year, sem).lastInsertRowid);
    };

    /* students: register numbers only (no names / dates of birth in the old data) */
    for (const r of files.students || []) {
      const reg = String(r.registerno || '').trim().toUpperCase();
      if (!/^[A-Z0-9/-]{3,30}$/.test(reg)) { stats.skipped++; continue; }
      if (db.get('SELECT 1 FROM students WHERE register_no = ?', reg)) continue;
      const d = dept(r.department);
      const c = classId(d, semNum(r.semester));
      db.run('INSERT INTO students(register_no, name, department_id, class_id) VALUES(?,?,?,?)', reg, reg, d, c);
      stats.students++;
    }

    /* mappings */
    const mappingId = (m) => {
      const d = dept(m.department);
      const sem = semNum(m.semester);
      const c = classId(d, sem);
      const f = facultyId(m.staff);
      const s = subjectId(m.subject, d, sem);
      if (!c || !f || !s) return null;
      const hit = db.get('SELECT id FROM mappings WHERE class_id = ? AND subject_id = ? AND faculty_id = ?', c, s, f);
      if (hit) return { id: hit.id, c, f, s, d, sem };
      stats.mappings++;
      return { id: Number(db.run('INSERT INTO mappings(class_id, subject_id, faculty_id) VALUES(?,?,?)', c, s, f).lastInsertRowid), c, f, s, d, sem };
    };
    for (const m of files.mapping || []) mappingId(m);

    /* ratings → anonymous feedback in a closed legacy cycle */
    if (files.ratings?.length) {
      const year = new Date().getFullYear();
      const cycleName = 'Legacy import (previous system)';
      let cycle = db.get('SELECT id FROM cycles WHERE name = ?', cycleName);
      if (!cycle) cycle = { id: Number(db.run("INSERT INTO cycles(name, academic_year, term, status) VALUES(?,?, 'Odd', 'closed')", cycleName, `${year - 1}-${String(year).slice(2)}`).lastInsertRowid) };
      const questions = db.all('SELECT id, position FROM questions ORDER BY position, id');
      for (const r of files.ratings) {
        const m = mappingId(r);
        const ratings = questions.slice(0, 10).map((q, i) => ({ qid: q.id, v: Number(r[`q${i + 1}`]) }));
        if (!m || ratings.some((x) => !(x.v >= 1 && x.v <= 10))) { stats.skipped++; continue; }
        const avg = Math.round((ratings.reduce((a, x) => a + x.v, 0) / ratings.length) * 100) / 100;
        const id = require('node:crypto').randomUUID();
        // The old file's register number column is deliberately NOT imported.
        db.run(`INSERT INTO feedback(id, cycle_id, mapping_id, faculty_id, subject_id, department_id, year, semester, section, average, comment, submitted_on)
                VALUES(?,?,?,?,?,?,?,?, 'A', ?, NULL, ?)`, id, cycle.id, m.id, m.f, m.s, m.d, Math.ceil(m.sem / 2), m.sem, avg, new Date().toISOString().slice(0, 10));
        for (const x of ratings) db.run('INSERT INTO feedback_answers(feedback_id, question_id, rating) VALUES(?,?,?)', id, x.qid, Math.round(x.v * 10) / 10);
        stats.feedback++;
      }
    }
    log(`Legacy import from ${dir}:`, stats);
    if (stats.students) log('Note: the old system stored no student names or dates of birth. Add dates of birth (Admin → Data import → Students, "Add & update"), or switch student sign-in to "Register number only" in Settings.');
    return stats;
  });
}

module.exports = { importLegacy };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: npm run import-legacy -- /path/to/old/feedback-system');
    process.exit(1);
  }
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'feedback.db');
  const db = require('./db').open(file);
  require('./seed').seed(db, { demo: false });
  importLegacy(db, path.resolve(dir));
}
