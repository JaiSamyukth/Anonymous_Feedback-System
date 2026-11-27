'use strict';
/**
 * Faculty portal API. A faculty member can only ever see aggregated feedback
 * about themselves. Small groups are suppressed so no individual student's
 * ratings can be inferred.
 *
 * Initial password: until a faculty member sets their own password, it is
 * their Staff ID. They must change it on first sign-in.
 */
const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword } = require('./db');
const { HttpError, str, rateLimiter } = require('./util');
const reports = require('./reports');
const exporter = require('./exporter');

const COOKIE = 'afs_fsession';
const HOURS = 8;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function checkFacultyPassword(fac, password) {
  if (fac.password_hash) return verifyPassword(password, fac.password_hash);
  return String(password).trim().toUpperCase() === String(fac.staff_id).toUpperCase();
}

module.exports = function facultyRouter(ctx, { secureCookies }) {
  const { db } = ctx;
  const r = express.Router();

  function current(req) {
    const token = ctx.parseCookies(req)[COOKIE];
    if (!token) return null;
    const row = db.get(
      `SELECT f.*, d.code AS department_code, d.name AS department_name, s.expires_at
         FROM faculty_sessions s JOIN faculty f ON f.id = s.faculty_id JOIN departments d ON d.id = f.department_id
        WHERE s.token_hash = ? AND f.status = 'active'`,
      hashToken(token),
    );
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  r.post('/login', rateLimiter({ windowMs: 60e3, max: 10 }), (req, res) => {
    const staffId = str(req.body?.staff_id).toUpperCase();
    const fac = db.get("SELECT * FROM faculty WHERE staff_id = ? AND status = 'active'", staffId);
    if (!fac || !checkFacultyPassword(fac, req.body?.password ?? '')) throw new HttpError(401, 'Incorrect Staff ID or password.');
    const token = crypto.randomBytes(32).toString('base64url');
    db.run('DELETE FROM faculty_sessions WHERE expires_at < ?', Date.now());
    db.run('INSERT INTO faculty_sessions(token_hash, faculty_id, expires_at) VALUES(?,?,?)', hashToken(token), fac.id, Date.now() + HOURS * 3600e3);
    db.run('UPDATE faculty SET last_login = ? WHERE id = ?', new Date().toISOString(), fac.id);
    res.set('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HOURS * 3600}${secureCookies ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    const token = ctx.parseCookies(req)[COOKIE];
    if (token) db.run('DELETE FROM faculty_sessions WHERE token_hash = ?', hashToken(token));
    res.set('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // Everything below requires a signed-in faculty member.
  r.use((req, res, next) => {
    const fac = current(req);
    if (!fac) return next(new HttpError(401, 'Please sign in.'));
    if (req.method !== 'GET' && req.get('x-afs') !== '1') return next(new HttpError(403, 'Missing request header.'));
    req.faculty = fac;
    next();
  });

  r.get('/me', (req, res) => {
    const f = req.faculty;
    res.json({
      name: f.name, staff_id: f.staff_id, designation: f.designation, department_code: f.department_code, department_name: f.department_name,
      mustChange: !f.password_hash || !!f.must_change_password,
      institution: db.getSetting('institution_name'),
    });
  });

  r.post('/password', (req, res) => {
    const f = req.faculty;
    if (!checkFacultyPassword(f, req.body?.current ?? '')) throw new HttpError(400, 'Your current password is incorrect.');
    const next = String(req.body?.next || '');
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
    if (next.toUpperCase() === f.staff_id.toUpperCase()) throw new HttpError(400, 'Choose a password that is different from your Staff ID.');
    db.run('UPDATE faculty SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), f.id);
    res.json({ ok: true });
  });

  // Reports are blocked until the initial password has been changed.
  const ready = (req) => {
    if (!req.faculty.password_hash || req.faculty.must_change_password) throw new HttpError(403, 'Please set a new password first.');
  };

  r.get('/meta', (req, res) => {
    ready(req);
    const id = req.faculty.id;
    res.json({
      cycles: db.all(
        `SELECT y.id, y.name, y.academic_year, y.term, y.status FROM cycles y
          WHERE y.status = 'open' OR EXISTS (SELECT 1 FROM feedback f WHERE f.cycle_id = y.id AND f.faculty_id = ?)
          ORDER BY y.academic_year DESC, y.term DESC, y.id DESC`, id),
      subjects: db.all(
        `SELECT DISTINCT s.id, s.code, s.name FROM subjects s
          WHERE s.id IN (SELECT subject_id FROM mappings WHERE faculty_id = ?) OR s.id IN (SELECT subject_id FROM feedback WHERE faculty_id = ?)
          ORDER BY s.name`, id, id),
      sections: db.all('SELECT DISTINCT section FROM feedback WHERE faculty_id = ? ORDER BY section', id).map((x) => x.section),
      minResponses: Number(db.getSetting('min_responses', '3')),
    });
  });

  function filters(req) {
    const f = reports.parseFilters(req.query, null);
    f.department_id = null; // a faculty member may teach in other departments
    f.faculty_id = req.faculty.id;
    return f;
  }

  r.get('/report', (req, res) => {
    ready(req);
    const d = reports.facultyDetail(db, filters(req), req.faculty);
    const min = d.minResponses;
    // Privacy for the faculty view: hide anything computed from too few students.
    d.breakdown = d.breakdown.map((b) => (b.responses < min ? { ...b, average: null, min: null, max: null, band_high: null, band_mid: null, band_low: null, suppressed: true } : b));
    if (d.totals.responses < min) {
      d.suppressed = true;
      d.questions = d.questions.map((q) => ({ ...q, average: null }));
      d.histogram = [];
      d.comments = [];
      d.totals = { responses: d.totals.responses, average: null };
    }
    delete d.faculty.password_hash;
    res.json(d);
  });

  r.get('/export', async (req, res) => {
    ready(req);
    const f = filters(req);
    const total = db.get('SELECT COUNT(*) n FROM feedback f JOIN cycles y ON y.id = f.cycle_id ' + reports.where(db, f).sql, ...reports.where(db, f).params).n;
    if (total < Number(db.getSetting('min_responses', '3'))) throw new HttpError(409, 'Not enough responses to export yet.');
    const buf = await exporter.build(db, f, { name: req.faculty.name }, { audience: 'faculty' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="my-feedback-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    });
    res.send(Buffer.from(buf));
  });

  return r;
};

module.exports.checkFacultyPassword = checkFacultyPassword;
