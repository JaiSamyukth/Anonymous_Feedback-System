'use strict';
const express = require('express');
const { hashPassword, normalizeDob } = require('./db');
const { HttpError, classLabel, str, int } = require('./util');
const reports = require('./reports');
const importer = require('./importer');
const exporter = require('./exporter');
const classreport = require('./classreport');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Entity definitions for generic CRUD.
 *   fields: name → { type, required, values, min, max }
 *   dept:   SQL expression giving the owning department (for HOD scoping)
 */
const ENTITIES = {
  departments: {
    table: 'departments',
    superOnly: true,
    fields: { code: { type: 'text', required: true, upper: true, max: 12 }, name: { type: 'text', required: true }, active: { type: 'bool' } },
    list: `SELECT d.*, (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id AND s.status='active') AS students,
                  (SELECT COUNT(*) FROM faculty f WHERE f.department_id = d.id AND f.status='active') AS faculty,
                  (SELECT COUNT(*) FROM classes c WHERE c.department_id = d.id AND c.active=1) AS classes
             FROM departments d`,
    dept: 'd.id',
    search: ['d.code', 'd.name'],
    order: 'd.code',
  },
  classes: {
    table: 'classes',
    fields: {
      department_id: { type: 'ref', ref: 'departments', required: true },
      year: { type: 'int', required: true, min: 1, max: 5 },
      semester: { type: 'int', required: true, min: 1, max: 10 },
      section: { type: 'text', required: true, upper: true, max: 4 },
      active: { type: 'bool' },
    },
    list: `SELECT c.*, d.code AS department_code,
                  (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status='active') AS students,
                  (SELECT COUNT(*) FROM mappings m WHERE m.class_id = c.id) AS mappings
             FROM classes c JOIN departments d ON d.id = c.department_id`,
    dept: 'c.department_id',
    search: ['d.code', 'c.section'],
    order: 'd.code, c.year, c.semester, c.section',
    validate(db, v) {
      if (v.year && v.semester && (v.semester < v.year * 2 - 1 || v.semester > v.year * 2)) {
        throw new HttpError(400, `Semester ${v.semester} does not belong to year ${v.year}. Year ${v.year} has semesters ${v.year * 2 - 1} and ${v.year * 2}.`);
      }
    },
  },
  students: {
    table: 'students',
    fields: {
      register_no: { type: 'text', required: true, upper: true, max: 30 },
      name: { type: 'text', required: true, max: 120 },
      department_id: { type: 'ref', ref: 'departments', required: true },
      class_id: { type: 'ref', ref: 'classes' },
      admission_year: { type: 'int', min: 1990, max: 2100 },
      dob: { type: 'dob' },
      status: { type: 'enum', values: ['active', 'inactive', 'graduated'] },
    },
    list: `SELECT s.*, d.code AS department_code, c.year, c.semester, c.section
             FROM students s JOIN departments d ON d.id = s.department_id LEFT JOIN classes c ON c.id = s.class_id`,
    dept: 's.department_id',
    search: ['s.register_no', 's.name'],
    filters: { class_id: 's.class_id', status: 's.status', year: 'c.year', section: 'c.section' },
    order: 's.register_no',
    validate(db, v) {
      if (v.class_id) {
        const c = db.get('SELECT department_id FROM classes WHERE id = ?', v.class_id);
        if (c && c.department_id !== v.department_id) throw new HttpError(400, 'The selected class belongs to a different department.');
      }
    },
  },
  faculty: {
    table: 'faculty',
    fields: {
      staff_id: { type: 'text', required: true, upper: true, max: 30 },
      name: { type: 'text', required: true, max: 120 },
      department_id: { type: 'ref', ref: 'departments', required: true },
      designation: { type: 'text', max: 60 },
      email: { type: 'text', max: 120 },
      status: { type: 'enum', values: ['active', 'inactive'] },
    },
    list: `SELECT f.id, f.staff_id, f.name, f.department_id, f.designation, f.email, f.status, f.last_login,
                  (f.password_hash IS NOT NULL AND f.must_change_password = 0) AS portal_ready, d.code AS department_code,
                  (SELECT COUNT(*) FROM mappings m WHERE m.faculty_id = f.id) AS mappings
             FROM faculty f JOIN departments d ON d.id = f.department_id`,
    dept: 'f.department_id',
    search: ['f.staff_id', 'f.name', 'f.designation'],
    filters: { status: 'f.status' },
    order: 'f.name',
  },
  subjects: {
    table: 'subjects',
    fields: {
      code: { type: 'text', required: true, upper: true, max: 20 },
      name: { type: 'text', required: true, max: 120 },
      department_id: { type: 'ref', ref: 'departments', required: true },
      semester: { type: 'int', min: 1, max: 10 },
      active: { type: 'bool' },
    },
    list: `SELECT s.*, d.code AS department_code FROM subjects s JOIN departments d ON d.id = s.department_id`,
    dept: 's.department_id',
    search: ['s.code', 's.name'],
    filters: { semester: 's.semester' },
    order: 's.code',
  },
  mappings: {
    table: 'mappings',
    fields: {
      class_id: { type: 'ref', ref: 'classes', required: true },
      subject_id: { type: 'ref', ref: 'subjects', required: true },
      faculty_id: { type: 'ref', ref: 'faculty', required: true },
    },
    list: `SELECT m.*, c.department_id, d.code AS department_code, c.year, c.semester, c.section,
                  s.code AS subject_code, s.name AS subject_name, f.name AS faculty_name, f.staff_id
             FROM mappings m JOIN classes c ON c.id = m.class_id JOIN departments d ON d.id = c.department_id
             JOIN subjects s ON s.id = m.subject_id JOIN faculty f ON f.id = m.faculty_id`,
    dept: 'c.department_id',
    search: ['s.name', 's.code', 'f.name', 'f.staff_id'],
    filters: { class_id: 'm.class_id', faculty_id: 'm.faculty_id' },
    order: 'd.code, c.year, c.semester, c.section, s.name',
    deptOf: (db, v) => db.get('SELECT department_id FROM classes WHERE id = ?', v.class_id)?.department_id,
    validate(db, v) {
      const c = db.get('SELECT department_id FROM classes WHERE id = ?', v.class_id);
      const s = db.get('SELECT department_id FROM subjects WHERE id = ?', v.subject_id);
      if (c && s && c.department_id !== s.department_id) throw new HttpError(400, 'The subject belongs to a different department than the class.');
    },
  },
  cycles: {
    table: 'cycles',
    superOnly: true,
    fields: {
      name: { type: 'text', required: true, max: 120 },
      academic_year: { type: 'text', required: true, pattern: /^\d{4}-\d{2}$/, hint: 'Use the format 2026-27.' },
      term: { type: 'enum', values: ['Odd', 'Even'], required: true },
      status: { type: 'enum', values: ['draft', 'open', 'closed'] },
      opens_on: { type: 'date' },
      closes_on: { type: 'date' },
    },
    list: `SELECT y.*, (SELECT COUNT(*) FROM feedback f WHERE f.cycle_id = y.id) AS responses FROM cycles y`,
    search: ['y.name', 'y.academic_year'],
    order: 'y.academic_year DESC, y.term DESC, y.id DESC',
    after(db, row) {
      // Only one cycle may be open at a time.
      if (row.status === 'open') db.run("UPDATE cycles SET status = 'closed' WHERE status = 'open' AND id <> ?", row.id);
    },
  },
  questions: {
    table: 'questions',
    superOnly: true,
    fields: {
      position: { type: 'int', required: true, min: 1, max: 99 },
      text: { type: 'text', required: true, max: 300 },
      short: { type: 'text', max: 40 },
      active: { type: 'bool' },
    },
    list: 'SELECT q.* FROM questions q',
    search: ['q.text'],
    order: 'q.position, q.id',
  },
  admins: {
    table: 'admins',
    superOnly: true,
    fields: {
      username: { type: 'text', required: true, max: 40, pattern: /^[a-zA-Z0-9._-]+$/, hint: 'Letters, numbers, dot, dash and underscore only.' },
      name: { type: 'text', required: true, max: 120 },
      role: { type: 'enum', values: ['super_admin', 'dept_admin'], required: true },
      department_id: { type: 'ref', ref: 'departments' },
      active: { type: 'bool' },
    },
    list: `SELECT a.id, a.username, a.name, a.role, a.department_id, a.active, a.last_login, d.code AS department_code
             FROM admins a LEFT JOIN departments d ON d.id = a.department_id`,
    search: ['a.username', 'a.name'],
    order: 'a.role DESC, a.username',
    validate(db, v) {
      if (v.role === 'dept_admin' && !v.department_id) throw new HttpError(400, 'A department admin must be assigned to a department.');
      if (v.role === 'super_admin') v.department_id = null;
    },
  },
};

function coerce(def, body, partial) {
  const out = {};
  for (const [name, f] of Object.entries(def.fields)) {
    if (!(name in body)) {
      if (!partial && f.required) throw new HttpError(400, `${label(name)} is required.`);
      continue;
    }
    let v = body[name];
    if (f.type === 'text' || f.type === 'enum' || f.type === 'date') {
      v = str(v);
      if (f.upper) v = v.toUpperCase();
      if (!v) {
        if (f.required) throw new HttpError(400, `${label(name)} is required.`);
        v = null;
      } else {
        if (f.max && v.length > f.max) throw new HttpError(400, `${label(name)} must be at most ${f.max} characters.`);
        if (f.pattern && !f.pattern.test(v)) throw new HttpError(400, `${label(name)} is not valid. ${f.hint || ''}`.trim());
        if (f.type === 'enum' && !f.values.includes(v)) throw new HttpError(400, `${label(name)} must be one of: ${f.values.join(', ')}.`);
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${label(name)} must be a date.`);
      }
    } else if (f.type === 'int' || f.type === 'ref') {
      v = int(v, f.type === 'int' ? { min: f.min, max: f.max } : { min: 1 });
      if (Number.isNaN(v)) throw new HttpError(400, `${label(name)} is not valid${f.min !== undefined ? ` (${f.min}–${f.max})` : ''}.`);
      if (v === null && f.required) throw new HttpError(400, `${label(name)} is required.`);
    } else if (f.type === 'dob') {
      v = normalizeDob(v);
      if (v === undefined) throw new HttpError(400, 'Date of birth is not a valid date.');
    } else if (f.type === 'bool') {
      v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    }
    out[name] = v;
  }
  return out;
}

const label = (name) => name.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

module.exports = function adminRouter(ctx) {
  const { db } = ctx;
  const r = express.Router();

  const isSuper = (req) => req.admin.role === 'super_admin';
  const requireSuper = (req) => {
    if (!isSuper(req)) throw new HttpError(403, 'Only a super administrator can do this.');
  };
  /** Department the admin is restricted to, or null for full access. */
  const scope = (req) => (isSuper(req) ? null : req.admin.department_id);

  /* ------------------------------------------------------------ meta/lookup */

  r.get('/meta', (req, res) => {
    const s = scope(req);
    const w = (col) => (s ? ` WHERE ${col} = ${Number(s)}` : '');
    res.json({
      me: { role: req.admin.role, department_id: req.admin.department_id },
      departments: db.all(`SELECT id, code, name, active FROM departments${w('id')} ORDER BY code`),
      classes: db
        .all(`SELECT c.id, c.department_id, c.year, c.semester, c.section, c.active, d.code AS department_code FROM classes c JOIN departments d ON d.id = c.department_id${w('c.department_id')} ORDER BY d.code, c.year, c.semester, c.section`)
        .map((c) => ({ ...c, label: classLabel(c) })),
      faculty: db.all(`SELECT id, staff_id, name, department_id, status FROM faculty${w('department_id')} ORDER BY name`),
      subjects: db.all(`SELECT id, code, name, department_id, semester FROM subjects${w('department_id')} ORDER BY name`),
      cycles: db.all('SELECT id, name, academic_year, term, status FROM cycles ORDER BY academic_year DESC, term DESC, id DESC'),
      questions: db.all('SELECT id, position, text, short, active FROM questions ORDER BY position, id'),
      settings: {
        institution_name: db.getSetting('institution_name'),
        institution_short: db.getSetting('institution_short'),
        require_verification: db.getSetting('require_verification') === '1',
        allow_comments: db.getSetting('allow_comments') === '1',
        min_responses: Number(db.getSetting('min_responses', '3')),
        student_auth: db.getSetting('student_auth', 'dob'),
        report_title: db.getSetting('report_title', ''),
        report_subtitle: db.getSetting('report_subtitle', ''),
        report_footer: db.getSetting('report_footer', ''),
        report_signatures: db.getSetting('report_signatures', ''),
      },
    });
  });

  /* ------------------------------------------------------------------ CRUD */

  for (const [name, def] of Object.entries(ENTITIES)) {
    const base = `/${name}`;

    r.get(base, (req, res) => {
      if (def.superOnly && name !== 'departments' && name !== 'cycles' && name !== 'questions') requireSuper(req);
      const where = [];
      const params = [];
      const s = scope(req);
      if (s && def.dept) { where.push(`${def.dept} = ?`); params.push(s); }
      if (req.query.department_id && def.dept) { where.push(`${def.dept} = ?`); params.push(Number(req.query.department_id)); }
      for (const [k, col] of Object.entries(def.filters || {})) {
        if (req.query[k] !== undefined && req.query[k] !== '') { where.push(`${col} = ?`); params.push(req.query[k]); }
      }
      const q = str(req.query.q);
      if (q && def.search) {
        where.push(`(${def.search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
        for (let i = 0; i < def.search.length; i++) params.push(`%${q}%`);
      }
      const sql = `${def.list}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
      const total = db.get(`SELECT COUNT(*) AS n FROM (${sql})`, ...params).n;
      const limit = Math.min(Number(req.query.limit) || 500, 2000);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const rows = db.all(`${sql} ORDER BY ${def.order} LIMIT ? OFFSET ?`, ...params, limit, offset);
      if (name === 'classes') for (const row of rows) row.label = classLabel(row);
      res.json({ total, rows });
    });

    const checkScope = (req, values, existing) => {
      if (def.superOnly) return requireSuper(req);
      const s = scope(req);
      if (!s) return;
      const deptOf = (v) => (def.deptOf ? def.deptOf(db, v) : v.department_id);
      if (existing && deptOf(existing) !== s) throw new HttpError(403, 'This record belongs to another department.');
      if (values && deptOf({ ...existing, ...values }) !== s) throw new HttpError(403, 'You can only manage records in your own department.');
    };

    const checkRefs = (values) => {
      for (const [k, f] of Object.entries(def.fields)) {
        if (f.type === 'ref' && values[k]) {
          if (!db.get(`SELECT 1 FROM ${f.ref} WHERE id = ?`, values[k])) throw new HttpError(400, `${label(k)} does not exist.`);
        }
      }
    };

    r.post(base, (req, res) => {
      const values = coerce(def, req.body || {}, false);
      if (name === 'admins') {
        const pw = String(req.body?.password || '');
        if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
        values.password_hash = hashPassword(pw);
        if (values.active === undefined) values.active = 1;
      }
      if (name === 'faculty' && req.body?.password) {
        if (String(req.body.password).length < 8) throw new HttpError(400, 'Portal password must be at least 8 characters.');
        values.password_hash = hashPassword(String(req.body.password));
        values.must_change_password = 1;
      }
      checkScope(req, values, null);
      checkRefs(values);
      def.validate?.(db, values);
      const cols = Object.keys(values);
      const info = db.run(`INSERT INTO ${def.table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => values[c]));
      const row = db.get(`SELECT * FROM ${def.table} WHERE id = ?`, info.lastInsertRowid);
      def.after?.(db, row);
      delete row.password_hash;
      res.status(201).json(row);
    });

    r.put(`${base}/:id`, (req, res) => {
      const existing = db.get(`SELECT * FROM ${def.table} WHERE id = ?`, Number(req.params.id));
      if (!existing) throw new HttpError(404, 'Record not found.');
      const values = coerce(def, req.body || {}, true);
      if (name === 'admins') {
        delete values.password_hash;
        if (req.body?.password) {
          if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
          values.password_hash = hashPassword(String(req.body.password));
        }
        if (existing.id === req.admin.id && (values.active === 0 || values.role === 'dept_admin')) {
          throw new HttpError(400, 'You cannot deactivate or demote your own account.');
        }
      }
      if (name === 'faculty') {
        if (req.body?.reset_password) { values.password_hash = null; values.must_change_password = 1; }
        else if (req.body?.password) {
          if (String(req.body.password).length < 8) throw new HttpError(400, 'Portal password must be at least 8 characters.');
          values.password_hash = hashPassword(String(req.body.password));
          values.must_change_password = 1;
        }
      }
      checkScope(req, values, existing);
      checkRefs(values);
      def.validate?.(db, { ...existing, ...values });
      if (name === 'admins' && values.role === 'super_admin') values.department_id = null;
      const cols = Object.keys(values);
      if (cols.length) db.run(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => values[c]), existing.id);
      const row = db.get(`SELECT * FROM ${def.table} WHERE id = ?`, existing.id);
      def.after?.(db, row);
      if (row.password_hash) delete row.password_hash;
      res.json(row);
    });

    r.delete(`${base}/:id`, (req, res) => {
      const existing = db.get(`SELECT * FROM ${def.table} WHERE id = ?`, Number(req.params.id));
      if (!existing) throw new HttpError(404, 'Record not found.');
      checkScope(req, null, existing);
      if (name === 'admins' && existing.id === req.admin.id) throw new HttpError(400, 'You cannot delete your own account.');
      // Deleting a mapping keeps its anonymous feedback (feedback.mapping_id is SET NULL).
      db.run(`DELETE FROM ${def.table} WHERE id = ?`, existing.id);
      res.json({ ok: true });
    });
  }

  // Bulk actions on students (e.g., promote to next class, mark graduated).
  r.post('/students/bulk', (req, res) => {
    const ids = (req.body?.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw new HttpError(400, 'No students selected.');
    const s = scope(req);
    const { action } = req.body;
    const n = db.tx(() => {
      let count = 0;
      for (const id of ids) {
        const st = db.get('SELECT * FROM students WHERE id = ?', id);
        if (!st || (s && st.department_id !== s)) continue;
        if (action === 'status') {
          if (!['active', 'inactive', 'graduated'].includes(req.body.status)) throw new HttpError(400, 'Invalid status.');
          db.run('UPDATE students SET status = ? WHERE id = ?', req.body.status, id);
        } else if (action === 'move') {
          const c = db.get('SELECT * FROM classes WHERE id = ?', Number(req.body.class_id));
          if (!c || c.department_id !== st.department_id) throw new HttpError(400, 'Target class must be in the same department.');
          db.run('UPDATE students SET class_id = ? WHERE id = ?', c.id, id);
        } else if (action === 'delete') {
          db.run('DELETE FROM students WHERE id = ?', id);
        } else throw new HttpError(400, 'Unknown action.');
        count++;
      }
      return count;
    });
    res.json({ ok: true, updated: n });
  });

  /* -------------------------------------------------------------- settings */

  r.put('/settings', (req, res) => {
    requireSuper(req);
    const b = req.body || {};
    if (b.institution_name !== undefined) {
      const v = str(b.institution_name);
      if (!v) throw new HttpError(400, 'Institution name is required.');
      db.setSetting('institution_name', v.slice(0, 150));
    }
    if (b.institution_short !== undefined) db.setSetting('institution_short', str(b.institution_short).slice(0, 20));
    if (b.require_verification !== undefined) db.setSetting('require_verification', b.require_verification ? '1' : '0');
    if (b.allow_comments !== undefined) db.setSetting('allow_comments', b.allow_comments ? '1' : '0');
    if (b.student_auth !== undefined) {
      if (!['dob', 'regno'].includes(b.student_auth)) throw new HttpError(400, 'Invalid student sign-in method.');
      db.setSetting('student_auth', b.student_auth);
    }
    for (const k of ['report_title', 'report_subtitle', 'report_footer', 'report_signatures']) {
      if (b[k] !== undefined) db.setSetting(k, str(b[k]).slice(0, 300));
    }
    if (b.min_responses !== undefined) {
      const n = int(b.min_responses, { min: 1, max: 50 });
      if (!n) throw new HttpError(400, 'Low-sample threshold must be between 1 and 50.');
      db.setSetting('min_responses', n);
    }
    res.json({ ok: true });
  });

  r.post('/password', (req, res) => {
    const { verifyPassword } = require('./db');
    const a = db.get('SELECT * FROM admins WHERE id = ?', req.admin.id);
    if (!verifyPassword(String(req.body?.current || ''), a.password_hash)) throw new HttpError(400, 'Your current password is incorrect.');
    const next = String(req.body?.next || '');
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
    db.run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(next), a.id);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------- reporting */

  const filtersOf = (req) => reports.parseFilters(req.query, scope(req));

  r.get('/dashboard', (req, res) => res.json(reports.dashboard(db, filtersOf(req))));
  r.get('/report', (req, res) => res.json(reports.grouped(db, filtersOf(req), str(req.query.group) || 'faculty')));
  // Official class report in the institution's printed format (JSON preview or PDF).
  r.get('/class-report', async (req, res) => {
    const f = filtersOf(req);
    const data = classreport.classReportData(db, f);
    if (req.query.format !== 'pdf') return res.json(data);
    const pdf = await classreport.buildPdf(data);
    const name = `feedback-report-${data.departmentCode || 'all'}-sem-${data.semester}${f.section ? '-' + f.section : ''}.pdf`.replace(/\s+/g, '-');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${name}"` });
    res.send(pdf);
  });

  // Full database backup (the new equivalent of the old "archive" button).
  r.get('/backup', (req, res) => {
    requireSuper(req);
    const tmp = path.join(os.tmpdir(), `afs-backup-${process.pid}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    res.set({ 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="feedback-backup-${new Date().toISOString().slice(0, 10)}.db"` });
    res.sendFile(tmp, () => fs.rm(tmp, { force: true }, () => {}));
  });

  // Add a continuous range of register numbers to one class (old "Add Students" screen).
  r.post('/students/range', (req, res) => {
    const cls = db.get('SELECT * FROM classes WHERE id = ?', Number(req.body?.class_id));
    if (!cls) throw new HttpError(400, 'Choose a class.');
    const s = scope(req);
    if (s && cls.department_id !== s) throw new HttpError(403, 'You can only add students to your own department.');
    const start = str(req.body?.start).toUpperCase();
    const end = str(req.body?.end).toUpperCase();
    const m1 = start.match(/^(.*?)(\d+)$/);
    const m2 = end.match(/^(.*?)(\d+)$/);
    if (!m1 || !m2 || m1[1] !== m2[1]) throw new HttpError(400, 'Start and end must share the same prefix and end in a number, e.g. 24CSBS001 to 24CSBS060.');
    const width = m1[2].length;
    const a = Number(m1[2]);
    const b = Number(m2[2]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b < a) throw new HttpError(400, 'The end number must be greater than or equal to the start number.');
    if (b - a + 1 > 300) throw new HttpError(400, 'Add at most 300 students at a time.');
    const admission = int(req.body?.admission_year, { min: 1990, max: 2100 });
    const out = db.tx(() => {
      let added = 0;
      const skipped = [];
      for (let n = a; n <= b; n++) {
        const reg = m1[1] + String(n).padStart(width, '0');
        if (db.get('SELECT 1 FROM students WHERE register_no = ?', reg)) { skipped.push(reg); continue; }
        db.run('INSERT INTO students(register_no, name, department_id, class_id, admission_year) VALUES(?,?,?,?,?)', reg, reg, cls.department_id, cls.id, Number.isNaN(admission) ? null : admission);
        added++;
      }
      return { added, skipped };
    });
    res.json(out);
  });

  // Replace the whole faculty-subject list of one class (old "Staff Mapping" screen).
  r.put('/classes/:id/mappings', (req, res) => {
    const cls = db.get('SELECT * FROM classes WHERE id = ?', Number(req.params.id));
    if (!cls) throw new HttpError(404, 'Class not found.');
    const s = scope(req);
    if (s && cls.department_id !== s) throw new HttpError(403, 'This class belongs to another department.');
    const pairs = (req.body?.pairs || []).map((p) => ({ subject_id: Number(p.subject_id), faculty_id: Number(p.faculty_id) })).filter((p) => p.subject_id && p.faculty_id);
    const seen = new Set();
    for (const p of pairs) {
      const sub = db.get('SELECT department_id FROM subjects WHERE id = ?', p.subject_id);
      if (!sub) throw new HttpError(400, 'A selected subject does not exist.');
      if (sub.department_id !== cls.department_id) throw new HttpError(400, 'Every subject must belong to the class’s department.');
      if (!db.get("SELECT 1 FROM faculty WHERE id = ? AND status = 'active'", p.faculty_id)) throw new HttpError(400, 'A selected faculty member does not exist or is inactive.');
      const k = `${p.subject_id}|${p.faculty_id}`;
      if (seen.has(k)) throw new HttpError(400, 'The same subject and faculty pair is listed twice.');
      seen.add(k);
    }
    const out = db.tx(() => {
      const existing = db.all('SELECT * FROM mappings WHERE class_id = ?', cls.id);
      let removed = 0;
      for (const m of existing) {
        if (!seen.has(`${m.subject_id}|${m.faculty_id}`)) { db.run('DELETE FROM mappings WHERE id = ?', m.id); removed++; }
      }
      let added = 0;
      for (const p of pairs) {
        if (!existing.some((m) => m.subject_id === p.subject_id && m.faculty_id === p.faculty_id)) {
          db.run('INSERT INTO mappings(class_id, subject_id, faculty_id) VALUES(?,?,?)', cls.id, p.subject_id, p.faculty_id);
          added++;
        }
      }
      return { added, removed, total: pairs.length };
    });
    res.json(out);
  });

  r.get('/matrix', (req, res) => res.json(reports.matrix(db, filtersOf(req), str(req.query.group) || 'class')));
  r.get('/report/faculty/:id', (req, res) => {
    const f = filtersOf(req);
    const fac = db.get('SELECT f.*, d.code AS department_code FROM faculty f JOIN departments d ON d.id = f.department_id WHERE f.id = ?', Number(req.params.id));
    if (!fac) throw new HttpError(404, 'Faculty not found.');
    // HODs may see their own faculty, plus feedback given in their department's classes.
    res.json(reports.facultyDetail(db, f, fac));
  });
  r.get('/responses', (req, res) => res.json(reports.responses(db, filtersOf(req), req.query)));
  r.get('/completion', (req, res) => res.json(reports.completion(db, filtersOf(req))));
  r.get('/completion/class/:id', (req, res) => {
    const f = filtersOf(req);
    const cls = db.get('SELECT * FROM classes WHERE id = ?', Number(req.params.id));
    if (!cls || (f.scope && cls.department_id !== f.scope)) throw new HttpError(404, 'Class not found.');
    res.json(reports.classCompletion(db, f, cls));
  });

  r.get('/export', async (req, res) => {
    const f = filtersOf(req);
    const buf = await exporter.build(db, f, req.admin);
    const name = `feedback-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    res.send(Buffer.from(buf));
  });

  /* --------------------------------------------------------------- imports */

  r.get('/import/types', (req, res) => res.json(importer.describe()));
  r.get('/import/template', async (req, res) => {
    const buf = await importer.template(str(req.query.type));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${str(req.query.type)}-template.xlsx"`,
    });
    res.send(Buffer.from(buf));
  });
  r.post('/import/preview', express.raw({ type: '*/*', limit: '15mb' }), async (req, res) => {
    const type = str(req.query.type);
    const mode = str(req.query.mode) === 'update' ? 'update' : 'add';
    const filename = str(req.query.filename) || 'upload';
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Please choose a file to upload.');
    if (type === 'departments') requireSuper(req);
    const out = await importer.preview(db, { type, mode, filename, buffer: req.body, scope: scope(req), admin: req.admin });
    res.json(out);
  });
  r.post('/import/commit', (req, res) => {
    const out = importer.commit(db, str(req.body?.token), req.admin, scope(req));
    res.json(out);
  });
  r.get('/imports', (req, res) => res.json(db.all('SELECT * FROM import_logs ORDER BY id DESC LIMIT 50')));

  return r;
};
