'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { verifyPassword, today, normalizeDob } = require('./db');
const { HttpError, classLabel, str, rateLimiter } = require('./util');
const adminRouter = require('./admin');
const facultyRouter = require('./faculty');

const SESSION_COOKIE = 'afs_session';
const SESSION_HOURS = 8;
const STUDENT_TOKEN_HOURS = 2;

function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, nginx…) set TRUST_PROXY=1 so rate limits see real client IPs.
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : 'loopback');
  app.use(express.json({ limit: '1mb' }));

  // Basic security headers.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'",
    });
    next();
  });

  const secret = Buffer.from(db.getSetting('secret'), 'hex');
  const ctx = { db, secret };
  ctx.parseCookies = (req) => parseCookies(req);

  /* ---------------------------------------------------------------- helpers */

  const activeCycle = () => db.get("SELECT * FROM cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  const activeQuestions = () => db.all('SELECT id, position, text, short FROM questions WHERE active = 1 ORDER BY position, id');

  function signStudentToken(studentId, cycleId) {
    const exp = Date.now() + STUDENT_TOKEN_HOURS * 3600e3;
    const payload = `${studentId}.${cycleId}.${exp}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return Buffer.from(payload).toString('base64url') + '.' + sig;
  }

  function readStudentToken(req) {
    const raw = str(req.get('x-student-token'));
    if (!raw) return null;
    const [p64, sig] = raw.split('.');
    if (!p64 || !sig) return null;
    const payload = Buffer.from(p64, 'base64url').toString();
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const [studentId, cycleId, exp] = payload.split('.').map(Number);
    if (!(exp > Date.now())) return null;
    return { studentId, cycleId };
  }

  function formsForClass(classId, cycleId, studentId) {
    const rows = db.all(
      `SELECT m.id AS mapping_id, s.id AS subject_id, s.code AS subject_code, s.name AS subject_name,
              f.id AS faculty_id, f.name AS faculty_name, f.designation
         FROM mappings m
         JOIN subjects s ON s.id = m.subject_id
         JOIN faculty f  ON f.id = m.faculty_id
        WHERE m.class_id = ? AND f.status = 'active' AND s.active = 1
        ORDER BY s.name, f.name`,
      classId,
    );
    if (studentId) {
      const done = new Set(
        db.all('SELECT mapping_id FROM completions WHERE student_id = ? AND cycle_id = ?', studentId, cycleId).map((r) => r.mapping_id),
      );
      for (const r of rows) r.completed = done.has(r.mapping_id);
    }
    return rows;
  }

  const classInfo = (classId) =>
    db.get(
      `SELECT c.*, d.code AS department_code, d.name AS department_name
         FROM classes c JOIN departments d ON d.id = c.department_id WHERE c.id = ?`,
      classId,
    );

  /* ------------------------------------------------------------ public API */

  const pub = express.Router();

  pub.get('/config', (req, res) => {
    const cycle = activeCycle();
    res.json({
      institution: db.getSetting('institution_name'),
      institution_short: db.getSetting('institution_short'),
      requireVerification: db.getSetting('require_verification') === '1',
      requireDob: db.getSetting('student_auth', 'dob') !== 'regno',
      allowComments: db.getSetting('allow_comments') === '1',
      cycle: cycle ? { id: cycle.id, name: cycle.name, academic_year: cycle.academic_year, term: cycle.term, closes_on: cycle.closes_on } : null,
      questions: activeQuestions(),
      departments: db.all('SELECT id, code, name FROM departments WHERE active = 1 ORDER BY code'),
    });
  });

  // Open mode only: browse classes / forms without verification.
  pub.get('/classes', (req, res) => {
    if (db.getSetting('require_verification') === '1') throw new HttpError(403, 'Verification is required.');
    const rows = db.all(
      `SELECT c.id, c.year, c.semester, c.section FROM classes c
        WHERE c.department_id = ? AND c.active = 1 ORDER BY c.year, c.semester, c.section`,
      Number(req.query.department_id),
    );
    res.json(rows);
  });

  pub.get('/forms', (req, res) => {
    const cycle = activeCycle();
    if (!cycle) throw new HttpError(409, 'No feedback cycle is open right now.');
    if (db.getSetting('require_verification') === '1') {
      const tok = readStudentToken(req);
      if (!tok || tok.cycleId !== cycle.id) throw new HttpError(401, 'Your session has expired. Please verify again.');
      const st = db.get("SELECT * FROM students WHERE id = ? AND status = 'active'", tok.studentId);
      if (!st) throw new HttpError(401, 'Student record not found.');
      return res.json({ forms: formsForClass(st.class_id, cycle.id, st.id) });
    }
    const cls = classInfo(Number(req.query.class_id));
    if (!cls || !cls.active) throw new HttpError(404, 'Class not found.');
    res.json({ class: { ...cls, label: classLabel(cls) }, forms: formsForClass(cls.id, cycle.id) });
  });

  // Per-register-number lockout on top of the per-IP rate limit: dates of birth are guessable.
  const failures = new Map(); // register_no → { count, until }
  const LOCK_AFTER = 5;
  const LOCK_MS = 15 * 60e3;

  // Per-IP limits are generous: a whole computer lab often shares one IP address.
  // Guessing is stopped by the per-register-number lockout instead.
  pub.post('/verify', rateLimiter({ windowMs: 60e3, max: 300 }), (req, res) => {
    if (db.getSetting('require_verification') !== '1') throw new HttpError(400, 'Verification is not enabled.');
    const cycle = activeCycle();
    if (!cycle) throw new HttpError(409, 'No feedback cycle is open right now. Please check back later.');
    const reg = str(req.body?.register_no).toUpperCase();
    const dob = normalizeDob(req.body?.dob);
    if (!/^[A-Z0-9/-]{3,30}$/.test(reg)) throw new HttpError(400, 'Please enter a valid register number.');
    const needDob = db.getSetting('student_auth', 'dob') !== 'regno';
    if (needDob && !dob) throw new HttpError(400, 'Please enter your date of birth.');

    const f = failures.get(reg);
    if (f && f.until > Date.now()) {
      throw new HttpError(429, `Too many incorrect attempts. Please try again in ${Math.ceil((f.until - Date.now()) / 60e3)} minutes.`);
    }
    const st = db.get('SELECT * FROM students WHERE register_no = ?', reg);
    // One generic message for "unknown number" and "wrong date" so register numbers can't be probed.
    if (!st || (needDob && (!st.dob || st.dob !== dob))) {
      const expired = f && f.until && f.until <= Date.now();
      const n = (f && !expired ? f.count : 0) + 1;
      failures.set(reg, { count: n, until: n >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
      if (failures.size > 10000) failures.clear();
      if (st && !st.dob) throw new HttpError(409, 'Your date of birth is not on record yet. Please contact your department office.');
      throw new HttpError(401, `The register number or date of birth is incorrect.${n >= LOCK_AFTER - 2 && n < LOCK_AFTER ? ` ${LOCK_AFTER - n} attempt(s) left before a 15-minute lock.` : ''}`);
    }
    failures.delete(reg);
    if (st.status !== 'active') throw new HttpError(403, `This register number is marked as ${st.status}. Contact your department office.`);
    const cls = st.class_id ? classInfo(st.class_id) : null;
    if (!cls || !cls.active) throw new HttpError(409, 'You are not assigned to an active class yet. Contact your department office.');
    // No name or register number is sent back: the portal never displays personal data.
    res.json({
      token: signStudentToken(st.id, cycle.id),
      class: { id: cls.id, department_code: cls.department_code, department_name: cls.department_name, year: cls.year, semester: cls.semester, section: cls.section, label: classLabel(cls) },
      forms: formsForClass(cls.id, cycle.id, st.id),
    });
  });

  pub.post('/submit', rateLimiter({ windowMs: 60e3, max: 600 }), (req, res) => {
    const cycle = activeCycle();
    if (!cycle) throw new HttpError(409, 'The feedback cycle has closed.');
    const mappingId = Number(req.body?.mapping_id);
    const m = db.get(
      `SELECT m.*, c.department_id, c.year, c.semester, c.section, c.active AS class_active
         FROM mappings m JOIN classes c ON c.id = m.class_id WHERE m.id = ?`,
      mappingId,
    );
    if (!m || !m.class_active) throw new HttpError(404, 'This feedback form is not available.');

    let studentId = null;
    if (db.getSetting('require_verification') === '1') {
      const tok = readStudentToken(req);
      if (!tok || tok.cycleId !== cycle.id) throw new HttpError(401, 'Your session has expired. Please verify your register number again.');
      const st = db.get("SELECT id, class_id FROM students WHERE id = ? AND status = 'active'", tok.studentId);
      if (!st || st.class_id !== m.class_id) throw new HttpError(403, 'This form does not belong to your class.');
      studentId = st.id;
    }

    // Validate ratings server-side: every active question, 1–10, max one decimal place.
    const questions = activeQuestions();
    const ratings = req.body?.ratings || {};
    const errors = [];
    const values = questions.map((q) => {
      const v = Number(ratings[q.id]);
      if (!Number.isFinite(v) || v < 1 || v > 10 || Math.abs(Math.round(v * 10) - v * 10) > 1e-9) {
        errors.push(`Q${q.position}`);
      }
      return { qid: q.id, rating: Math.round(v * 10) / 10 };
    });
    if (errors.length) throw new HttpError(400, `Please give a rating between 1 and 10 for ${errors.join(', ')}.`);

    let comment = null;
    if (db.getSetting('allow_comments') === '1') {
      comment = str(req.body?.comment).slice(0, 1000) || null;
    }
    const average = Math.round((values.reduce((s, x) => s + x.rating, 0) / values.length) * 100) / 100;
    const day = today();

    db.tx(() => {
      if (studentId) {
        const done = db.get('SELECT 1 FROM completions WHERE student_id = ? AND cycle_id = ? AND mapping_id = ?', studentId, cycle.id, m.id);
        if (done) throw new HttpError(409, 'You have already submitted feedback for this faculty and subject.');
        db.run('INSERT INTO completions(student_id, cycle_id, mapping_id, completed_on) VALUES(?,?,?,?)', studentId, cycle.id, m.id, day);
      }
      // Anonymous record — note: no studentId is written here.
      const id = crypto.randomUUID();
      db.run(
        `INSERT INTO feedback(id, cycle_id, mapping_id, faculty_id, subject_id, department_id, year, semester, section, average, comment, submitted_on)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, cycle.id, m.id, m.faculty_id, m.subject_id, m.department_id, m.year, m.semester, m.section, average, comment, day,
      );
      const ins = db.prepare('INSERT INTO feedback_answers(feedback_id, question_id, rating) VALUES(?,?,?)');
      for (const v of values) ins.run(id, v.qid, v.rating);
    });

    res.status(201).json({ ok: true, average });
  });

  app.use('/api/public', pub);

  /* ------------------------------------------------------------------ auth */

  function parseCookies(req) {
    const out = {};
    for (const part of (req.get('cookie') || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

  function currentAdmin(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const row = db.get(
      `SELECT a.id, a.username, a.name, a.role, a.department_id, a.password_hash, d.code AS department_code, s.expires_at
         FROM sessions s JOIN admins a ON a.id = s.admin_id LEFT JOIN departments d ON d.id = a.department_id
        WHERE s.token_hash = ? AND a.active = 1`,
      hashToken(token),
    );
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  const auth = express.Router();
  auth.post('/login', rateLimiter({ windowMs: 60e3, max: 10 }), (req, res) => {
    const username = str(req.body?.username);
    const password = String(req.body?.password ?? '');
    const admin = db.get('SELECT * FROM admins WHERE username = ? AND active = 1', username);
    if (!admin || !verifyPassword(password, admin.password_hash)) throw new HttpError(401, 'Incorrect username or password.');
    const token = crypto.randomBytes(32).toString('base64url');
    db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    db.run('INSERT INTO sessions(token_hash, admin_id, expires_at) VALUES(?,?,?)', hashToken(token), admin.id, Date.now() + SESSION_HOURS * 3600e3);
    db.run('UPDATE admins SET last_login = ? WHERE id = ?', new Date().toISOString(), admin.id);
    res.set(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secureCookies ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });

  auth.post('/logout', (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    res.set('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  auth.get('/me', (req, res) => {
    const a = currentAdmin(req);
    if (!a) throw new HttpError(401, 'Not signed in.');
    res.json({
      id: a.id,
      username: a.username,
      name: a.name,
      role: a.role,
      department_id: a.department_id,
      department_code: a.department_code,
      defaultPassword: verifyPassword(a.role === 'super_admin' ? 'admin123' : 'hod123', a.password_hash),
      institution: db.getSetting('institution_name'),
    });
  });

  app.use('/api/auth', auth);

  /* ----------------------------------------------------------------- admin */

  app.use(
    '/api/admin',
    (req, res, next) => {
      const a = currentAdmin(req);
      if (!a) return next(new HttpError(401, 'Your session has expired. Please sign in again.'));
      // CSRF defence in depth (cookie is SameSite=Strict): mutations need a custom header.
      if (req.method !== 'GET' && req.get('x-afs') !== '1') return next(new HttpError(403, 'Missing request header.'));
      req.admin = a;
      next();
    },
    adminRouter(ctx),
  );

  /* --------------------------------------------------------------- faculty */

  app.use('/api/faculty', facultyRouter(ctx, { secureCookies }));

  /* ---------------------------------------------------------------- static */

  const pub_dir = path.join(__dirname, '..', 'public');
  app.use(express.static(pub_dir, { extensions: ['html'] }));
  app.get('/admin', (req, res) => res.sendFile(path.join(pub_dir, 'admin.html')));
  app.get('/faculty', (req, res) => res.sendFile(path.join(pub_dir, 'faculty.html')));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The uploaded file is too large.' });
    if (/UNIQUE constraint failed/.test(err.message)) return res.status(409).json({ error: 'A record with the same unique value already exists.' });
    if (/FOREIGN KEY constraint failed/.test(err.message)) return res.status(409).json({ error: 'This record is still referenced by other data. Deactivate it instead of deleting.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = { createApp };
