'use strict';
/**
 * Reporting & analytics over the anonymous feedback tables.
 * Nothing in here touches `students` together with `feedback`; completion
 * tracking reads only `completions`, which carries no ratings.
 */
const { classLabel, toRoman, str } = require('./util');

const round = (v, d = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

function parseFilters(q, scope) {
  const num = (v) => (v === undefined || v === '' || v === 'all' ? null : Number(v) || null);
  const f = {
    scope: scope || null,
    cycle_id: q.cycle_id === 'all' ? 'all' : num(q.cycle_id),
    academic_year: str(q.academic_year) || null,
    term: ['Odd', 'Even'].includes(q.term) ? q.term : null,
    department_id: num(q.department_id),
    year: num(q.year),
    semester: num(q.semester),
    section: str(q.section).toUpperCase() || null,
    faculty_id: num(q.faculty_id),
    subject_id: num(q.subject_id),
  };
  if (scope) f.department_id = scope;
  return f;
}

/** Resolves cycle_id=null to the open (or most recent) cycle. */
function resolveCycle(db, f) {
  if (f.cycle_id === 'all') return null;
  if (f.cycle_id) return f.cycle_id;
  const c =
    db.get("SELECT id FROM cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1") ||
    db.get('SELECT id FROM cycles ORDER BY academic_year DESC, term DESC, id DESC LIMIT 1');
  return c ? c.id : null;
}

function where(db, f, { skip = [] } = {}) {
  const w = [];
  const p = [];
  const add = (key, sql, val) => {
    if (skip.includes(key) || val === null || val === undefined) return;
    w.push(sql);
    p.push(val);
  };
  const cycle = skip.includes('cycle_id') ? null : resolveCycle(db, f);
  add('cycle_id', 'f.cycle_id = ?', cycle);
  add('academic_year', 'y.academic_year = ?', f.academic_year);
  add('term', 'y.term = ?', f.term);
  add('department_id', 'f.department_id = ?', f.department_id);
  add('year', 'f.year = ?', f.year);
  add('semester', 'f.semester = ?', f.semester);
  add('section', 'f.section = ?', f.section);
  add('faculty_id', 'f.faculty_id = ?', f.faculty_id);
  add('subject_id', 'f.subject_id = ?', f.subject_id);
  // HOD scope is never skippable.
  if (f.scope && skip.includes('department_id')) { w.push('f.department_id = ?'); p.push(f.scope); }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p, cycle };
}

const FROM = 'FROM feedback f JOIN cycles y ON y.id = f.cycle_id';
const STATS = `COUNT(*) AS responses, AVG(f.average) AS average, MIN(f.average) AS min, MAX(f.average) AS max,
  SUM(CASE WHEN f.average >= 8 THEN 1 ELSE 0 END) AS band_high,
  SUM(CASE WHEN f.average >= 6 AND f.average < 8 THEN 1 ELSE 0 END) AS band_mid,
  SUM(CASE WHEN f.average < 6 THEN 1 ELSE 0 END) AS band_low`;

const GROUPS = {
  faculty: {
    select: 'fa.id AS faculty_id, fa.name AS label, fa.staff_id AS sub, fa.designation, d.code AS department_code, COUNT(DISTINCT f.subject_id) AS subjects',
    join: 'JOIN faculty fa ON fa.id = f.faculty_id JOIN departments d ON d.id = fa.department_id',
    by: 'fa.id',
  },
  subject: {
    select: "s.id AS subject_id, s.name AS label, s.code AS sub, d.code AS department_code, COUNT(DISTINCT f.faculty_id) AS faculty_count, GROUP_CONCAT(DISTINCT fa.name) AS faculty_names",
    join: 'JOIN subjects s ON s.id = f.subject_id JOIN departments d ON d.id = s.department_id JOIN faculty fa ON fa.id = f.faculty_id',
    by: 's.id',
  },
  class: {
    select: 'd.code AS department_code, f.year, f.semester, f.section, COUNT(DISTINCT f.faculty_id) AS faculty_count',
    join: 'JOIN departments d ON d.id = f.department_id',
    by: 'f.department_id, f.year, f.semester, f.section',
    label: (r) => classLabel(r),
  },
  section: { select: "'Section ' || f.section AS label", join: '', by: 'f.section' },
  department: {
    select: 'd.id AS department_id, d.code AS label, d.name AS sub, COUNT(DISTINCT f.faculty_id) AS faculty_count',
    join: 'JOIN departments d ON d.id = f.department_id',
    by: 'd.id',
  },
  academic_year: { select: "'AY ' || y.academic_year AS label", join: '', by: 'y.academic_year', order: 'y.academic_year' },
  semester: { select: 'f.semester', join: '', by: 'f.semester', order: 'f.semester', label: (r) => `Semester ${toRoman(r.semester)}` },
  cycle: { select: 'y.id AS cycle_id, y.name AS label, y.academic_year, y.term', join: '', by: 'y.id', order: 'y.academic_year, y.term DESC' },
};

function grouped(db, f, group) {
  const minResponses = Number(db.getSetting('min_responses', '3'));
  const skip = ['academic_year', 'semester', 'cycle'].includes(group) ? ['cycle_id'] : [];
  const w = where(db, f, { skip });
  if (group === 'question') {
    const rows = db
      .all(
        `SELECT q.id AS question_id, q.position, q.text, q.short, COUNT(*) AS responses, AVG(a.rating) AS average, MIN(a.rating) AS min, MAX(a.rating) AS max
           ${FROM} JOIN feedback_answers a ON a.feedback_id = f.id JOIN questions q ON q.id = a.question_id
           ${w.sql} GROUP BY q.id ORDER BY q.position`,
        ...w.params,
      )
      .map((r) => ({ ...r, label: `Q${r.position}. ${r.short || r.text}`, average: round(r.average) }));
    return { group, rows, overall: overall(db, w), minResponses };
  }
  const g = GROUPS[group] || GROUPS.faculty;
  const rows = db
    .all(`SELECT ${g.select}, ${STATS} ${FROM} ${g.join} ${w.sql} GROUP BY ${g.by} ORDER BY ${g.order || 'average DESC'}`, ...w.params)
    .map((r) => ({
      ...r,
      label: g.label ? g.label(r) : r.label,
      average: round(r.average),
      lowSample: r.responses < minResponses,
    }));
  return { group, rows, overall: overall(db, w), minResponses };
}

function overall(db, w) {
  const r = db.get(`SELECT ${STATS} ${FROM} ${w.sql}`, ...w.params);
  return { ...r, average: round(r.average) };
}

function questionAverages(db, w) {
  return db
    .all(
      `SELECT q.id, q.position, q.short, q.text, AVG(a.rating) AS average
         ${FROM} JOIN feedback_answers a ON a.feedback_id = f.id JOIN questions q ON q.id = a.question_id
         ${w.sql} GROUP BY q.id ORDER BY q.position`,
      ...w.params,
    )
    .map((r) => ({ ...r, average: round(r.average) }));
}

/** Completion figures from `completions` only (no ratings involved). */
function completionTotals(db, f, cycleId) {
  if (!cycleId) return null;
  const cw = ['c.active = 1'];
  const cp = [];
  if (f.department_id) { cw.push('c.department_id = ?'); cp.push(f.department_id); }
  if (f.year) { cw.push('c.year = ?'); cp.push(f.year); }
  if (f.semester) { cw.push('c.semester = ?'); cp.push(f.semester); }
  if (f.section) { cw.push('c.section = ?'); cp.push(f.section); }
  const rows = db.all(
    `SELECT c.id, c.department_id, d.code AS department_code, c.year, c.semester, c.section,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active') AS students,
            (SELECT COUNT(*) FROM mappings m WHERE m.class_id = c.id) AS forms,
            (SELECT COUNT(*) FROM completions k JOIN students s ON s.id = k.student_id JOIN mappings m ON m.id = k.mapping_id
               WHERE k.cycle_id = ? AND s.class_id = c.id AND m.class_id = c.id AND s.status = 'active') AS completed,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND
               (SELECT COUNT(*) FROM completions k JOIN mappings m ON m.id = k.mapping_id WHERE k.student_id = s.id AND k.cycle_id = ? AND m.class_id = c.id)
               >= (SELECT COUNT(*) FROM mappings m WHERE m.class_id = c.id) AND (SELECT COUNT(*) FROM mappings m WHERE m.class_id = c.id) > 0) AS students_done,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'active' AND
               EXISTS (SELECT 1 FROM completions k WHERE k.student_id = s.id AND k.cycle_id = ?)) AS students_started
       FROM classes c JOIN departments d ON d.id = c.department_id
      WHERE ${cw.join(' AND ')} ORDER BY d.code, c.year, c.semester, c.section`,
    cycleId, cycleId, cycleId, ...cp,
  );
  for (const r of rows) {
    r.label = classLabel(r);
    r.expected = r.students * r.forms;
    r.rate = r.expected ? round((r.completed / r.expected) * 100, 1) : 0;
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const expected = sum('expected');
  return {
    classes: rows,
    students: sum('students'),
    students_done: sum('students_done'),
    students_started: sum('students_started'),
    expected,
    completed: sum('completed'),
    rate: expected ? round((sum('completed') / expected) * 100, 1) : 0,
  };
}

function dashboard(db, f) {
  const w = where(db, f);
  const minResponses = Number(db.getSetting('min_responses', '3'));
  const cycle = w.cycle ? db.get('SELECT * FROM cycles WHERE id = ?', w.cycle) : null;
  const totals = overall(db, w);
  const comp = completionTotals(db, f, w.cycle);

  const byDept = db
    .all(
      `SELECT d.id, d.code, d.name, COUNT(*) AS responses, AVG(f.average) AS average
         ${FROM} JOIN departments d ON d.id = f.department_id ${w.sql} GROUP BY d.id ORDER BY d.code`,
      ...w.params,
    )
    .map((r) => {
      const cls = comp ? comp.classes.filter((c) => c.department_id === r.id) : [];
      const exp = cls.reduce((s, c) => s + c.expected, 0);
      const done = cls.reduce((s, c) => s + c.completed, 0);
      return { ...r, average: round(r.average), completion: exp ? round((done / exp) * 100, 1) : null };
    });

  const fac = db
    .all(
      `SELECT fa.id, fa.name, d.code AS department_code, COUNT(*) AS responses, AVG(f.average) AS average
         ${FROM} JOIN faculty fa ON fa.id = f.faculty_id JOIN departments d ON d.id = fa.department_id
         ${w.sql} GROUP BY fa.id HAVING COUNT(*) >= ? ORDER BY average DESC`,
      ...w.params, minResponses,
    )
    .map((r) => ({ ...r, average: round(r.average) }));

  const daily = db.all(`SELECT f.submitted_on AS day, COUNT(*) AS responses ${FROM} ${w.sql} GROUP BY f.submitted_on ORDER BY f.submitted_on`, ...w.params);

  const tw = where(db, f, { skip: ['cycle_id', 'academic_year', 'term'] });
  const trend = db
    .all(
      `SELECT y.id, y.name, y.academic_year, y.term, COUNT(*) AS responses, AVG(f.average) AS average
         ${FROM} ${tw.sql} GROUP BY y.id ORDER BY y.academic_year, y.term DESC`,
      ...tw.params,
    )
    .map((r) => ({ ...r, average: round(r.average) }));

  const facultyCount = db.get(`SELECT COUNT(*) AS n FROM faculty WHERE status = 'active'${f.department_id ? ' AND department_id = ?' : ''}`, ...(f.department_id ? [f.department_id] : [])).n;

  return {
    cycle,
    totals,
    completion: comp && { ...comp, classes: undefined },
    facultyRated: fac.length,
    facultyCount,
    byDepartment: byDept,
    questions: questionAverages(db, w),
    top: fac.slice(0, 5),
    attention: fac.slice(-5).reverse().filter((r) => !fac.slice(0, 5).includes(r)),
    daily,
    trend,
    minResponses,
  };
}

function facultyDetail(db, f, fac) {
  const ff = { ...f, faculty_id: fac.id };
  const w = where(db, ff);
  const minResponses = Number(db.getSetting('min_responses', '3'));
  const totals = overall(db, w);
  const questions = questionAverages(db, w);

  // Comparison: same filters, all faculty in the same department, and institution-wide.
  const deptW = where(db, { ...f, faculty_id: null, department_id: f.scope || fac.department_id });
  const deptQ = questionAverages(db, deptW);
  const deptAvg = overall(db, deptW).average;

  const breakdown = db
    .all(
      `SELECT s.code AS subject_code, s.name AS subject_name, d.code AS department_code, f.year, f.semester, f.section, ${STATS}
         ${FROM} JOIN subjects s ON s.id = f.subject_id JOIN departments d ON d.id = f.department_id
         ${w.sql} GROUP BY f.subject_id, f.department_id, f.year, f.semester, f.section ORDER BY s.name, f.section`,
      ...w.params,
    )
    .map((r) => ({ ...r, label: classLabel(r), average: round(r.average), lowSample: r.responses < minResponses }));

  const tw = where(db, ff, { skip: ['cycle_id', 'academic_year', 'term'] });
  const trend = db
    .all(`SELECT y.id, y.name, y.academic_year, y.term, COUNT(*) AS responses, AVG(f.average) AS average ${FROM} ${tw.sql} GROUP BY y.id ORDER BY y.academic_year, y.term DESC`, ...tw.params)
    .map((r) => ({ ...r, average: round(r.average) }));

  const histogram = Array.from({ length: 9 }, (_, i) => ({ from: i + 1, to: i + 2, count: 0 }));
  for (const r of db.all(`SELECT f.average ${FROM} ${w.sql}`, ...w.params)) {
    histogram[Math.min(8, Math.max(0, Math.floor(r.average) - 1))].count++;
  }

  const comments = db.all(
    `SELECT f.comment, f.submitted_on, s.name AS subject_name, f.section, f.average
       ${FROM} JOIN subjects s ON s.id = f.subject_id ${w.sql} ${w.sql ? 'AND' : 'WHERE'} f.comment IS NOT NULL
       ORDER BY f.submitted_on DESC LIMIT 100`,
    ...w.params,
  );

  return {
    faculty: fac,
    totals,
    questions: questions.map((q) => ({ ...q, department: deptQ.find((d) => d.id === q.id)?.average ?? null })),
    departmentAverage: deptAvg,
    breakdown,
    trend,
    histogram,
    comments,
    minResponses,
  };
}

function responses(db, f, q) {
  const w = where(db, f);
  const extra = q.comments === '1' ? `${w.sql ? 'AND' : 'WHERE'} f.comment IS NOT NULL` : '';
  const limit = Math.min(Number(q.limit) || 50, 500);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const total = db.get(`SELECT COUNT(*) AS n ${FROM} ${w.sql} ${extra}`, ...w.params).n;
  const rows = db.all(
    `SELECT f.id, f.submitted_on, f.average, f.comment, f.year, f.semester, f.section, d.code AS department_code,
            fa.name AS faculty_name, s.name AS subject_name, s.code AS subject_code
       ${FROM} JOIN faculty fa ON fa.id = f.faculty_id JOIN subjects s ON s.id = f.subject_id JOIN departments d ON d.id = f.department_id
       ${w.sql} ${extra} ORDER BY f.submitted_on DESC, f.id LIMIT ? OFFSET ?`,
    ...w.params, limit, offset,
  );
  const ans = db.prepare('SELECT question_id, rating FROM feedback_answers WHERE feedback_id = ?');
  for (const r of rows) {
    r.label = classLabel(r);
    r.ratings = Object.fromEntries(ans.all(r.id).map((a) => [a.question_id, a.rating]));
    delete r.id; // the random id is meaningless to admins; don't expose it
  }
  return { total, rows };
}

function completion(db, f) {
  const cycle = resolveCycle(db, f);
  const c = completionTotals(db, f, cycle);
  return { cycle: cycle ? db.get('SELECT * FROM cycles WHERE id = ?', cycle) : null, ...c };
}

/** Per-student completion for one class. Shows WHO is pending, never WHAT anyone answered. */
function classCompletion(db, f, cls) {
  const cycle = resolveCycle(db, f);
  const forms = db.all(
    `SELECT m.id, s.name AS subject_name, s.code AS subject_code, fa.name AS faculty_name,
            (SELECT COUNT(*) FROM completions k JOIN students st ON st.id = k.student_id
               WHERE k.mapping_id = m.id AND k.cycle_id = ? AND st.status = 'active' AND st.class_id = m.class_id) AS completed
       FROM mappings m JOIN subjects s ON s.id = m.subject_id JOIN faculty fa ON fa.id = m.faculty_id
      WHERE m.class_id = ? ORDER BY s.name`,
    cycle, cls.id,
  );
  const students = db.all(
    `SELECT st.register_no, st.name,
            (SELECT COUNT(*) FROM completions k JOIN mappings m ON m.id = k.mapping_id WHERE k.student_id = st.id AND k.cycle_id = ? AND m.class_id = st.class_id) AS done
       FROM students st WHERE st.class_id = ? AND st.status = 'active' ORDER BY st.register_no`,
    cycle, cls.id,
  );
  const d = db.get('SELECT code FROM departments WHERE id = ?', cls.department_id);
  return { class: { ...cls, label: classLabel({ ...cls, department_code: d.code }) }, forms, students, total: forms.length };
}

module.exports = { parseFilters, resolveCycle, where, grouped, dashboard, facultyDetail, responses, completion, classCompletion, FROM, round };
