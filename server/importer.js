'use strict';
/**
 * Bulk import of institutional data from CSV / Excel.
 *
 * Flow: upload → parse → validate → preview (new / update / exists / duplicate / invalid)
 *       → admin confirms → re-validate & save in one transaction → import report.
 * Imports never delete or replace the existing data set.
 */
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { HttpError, parseOrdinal, str } = require('./util');

const TYPES = {
  departments: {
    title: 'Departments',
    columns: [
      { key: 'code', label: 'Department Code', required: true, aliases: ['deptcode', 'code', 'departmentid'] },
      { key: 'name', label: 'Department Name', required: true, aliases: ['name', 'department', 'deptname'] },
    ],
    sample: [['CSE', 'Computer Science and Engineering'], ['IT', 'Information Technology']],
  },
  classes: {
    title: 'Classes & sections',
    columns: [
      { key: 'department', label: 'Department', required: true, aliases: ['dept', 'departmentcode'] },
      { key: 'year', label: 'Academic Year', required: true, aliases: ['year', 'studyyear', 'currentyear'] },
      { key: 'semester', label: 'Semester', required: true, aliases: ['sem'] },
      { key: 'section', label: 'Section', required: true, aliases: ['sec'] },
    ],
    sample: [['CSBS', 'III', 'V', 'A'], ['CSBS', 'III', 'V', 'B']],
  },
  students: {
    title: 'Students',
    columns: [
      { key: 'register_no', label: 'Register Number', required: true, aliases: ['registerno', 'regno', 'registernumber', 'rollno', 'rollnumber'] },
      { key: 'name', label: 'Name', required: true, aliases: ['studentname', 'fullname'] },
      { key: 'department', label: 'Department', required: true, aliases: ['dept', 'departmentcode'] },
      { key: 'year', label: 'Year', required: true, aliases: ['currentyear', 'academicyear', 'studyyear'] },
      { key: 'semester', label: 'Semester', required: true, aliases: ['sem'] },
      { key: 'section', label: 'Section', required: true, aliases: ['sec'] },
      { key: 'admission_year', label: 'Admission Year', aliases: ['admissionyear', 'batch', 'yearofjoining'] },
      { key: 'status', label: 'Status', aliases: [] },
    ],
    sample: [['24CSBS001', 'Student A', 'CSBS', 'III', 'V', 'A', '2024', 'active'], ['24CSBS002', 'Student B', 'CSBS', 'III', 'V', 'A', '2024', 'active']],
  },
  faculty: {
    title: 'Faculty',
    columns: [
      { key: 'staff_id', label: 'Staff ID', required: true, aliases: ['staffid', 'facultyid', 'employeeid', 'empid', 'id'] },
      { key: 'name', label: 'Faculty Name', required: true, aliases: ['name', 'facultyname', 'staffname'] },
      { key: 'department', label: 'Department', required: true, aliases: ['dept', 'departmentcode'] },
      { key: 'designation', label: 'Designation', aliases: [] },
      { key: 'email', label: 'Email', aliases: ['mail', 'emailid'] },
      { key: 'status', label: 'Status', aliases: [] },
    ],
    sample: [['FAC201', 'Dr. Faculty A', 'CSBS', 'Professor', 'faculty.a@college.edu', 'active']],
  },
  subjects: {
    title: 'Subjects',
    columns: [
      { key: 'code', label: 'Subject Code', required: true, aliases: ['subjectcode', 'coursecode', 'code'] },
      { key: 'name', label: 'Subject Name', required: true, aliases: ['subject', 'subjectname', 'coursename', 'name'] },
      { key: 'department', label: 'Department', required: true, aliases: ['dept', 'departmentcode'] },
      { key: 'semester', label: 'Semester', aliases: ['sem'] },
    ],
    sample: [['CS3501', 'Data Structures', 'CSBS', 'V']],
  },
  mappings: {
    title: 'Faculty–subject mapping',
    columns: [
      { key: 'staff_id', label: 'Faculty ID', required: true, aliases: ['staffid', 'facultyid', 'employeeid'] },
      { key: 'subject_code', label: 'Subject Code', required: true, aliases: ['subjectcode', 'coursecode', 'subject'] },
      { key: 'department', label: 'Department', required: true, aliases: ['dept', 'departmentcode'] },
      { key: 'year', label: 'Year', required: true, aliases: ['academicyear', 'studyyear'] },
      { key: 'semester', label: 'Semester', required: true, aliases: ['sem'] },
      { key: 'section', label: 'Section', required: true, aliases: ['sec'] },
    ],
    sample: [['FAC201', 'CS3501', 'CSBS', 'III', 'V', 'A']],
  },
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function describe() {
  return Object.entries(TYPES).map(([key, t]) => ({
    key,
    title: t.title,
    columns: t.columns.map((c) => ({ label: c.label, required: !!c.required })),
  }));
}

async function template(type) {
  const t = TYPES[type];
  if (!t) throw new HttpError(400, 'Unknown import type.');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  ws.addRow(t.columns.map((c) => c.label));
  for (const r of t.sample) ws.addRow(r);
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
  ws.columns.forEach((c, i) => (c.width = Math.max(14, t.columns[i].label.length + 4)));
  return wb.xlsx.writeBuffer();
}

/* ---------------------------------------------------------------- parsing */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

async function readTable(buffer, filename) {
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b; // xlsx is a zip
  if (isZip || /\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new HttpError(400, 'This Excel file could not be read. Save it as .xlsx or .csv and try again.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new HttpError(400, 'The workbook has no sheets.');
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(row.getCell(c).value));
      rows.push(vals);
    });
    return rows;
  }
  if (/\.xls$/i.test(filename)) throw new HttpError(400, 'Old .xls files are not supported. Please save as .xlsx or .csv.');
  return parseCsv(buffer.toString('utf8'));
}

function mapHeaders(type, header) {
  const t = TYPES[type];
  const idx = {};
  const normalized = header.map(norm);
  for (const col of t.columns) {
    const names = [norm(col.label), norm(col.key), ...col.aliases];
    const i = normalized.findIndex((h) => names.includes(h));
    if (i >= 0) idx[col.key] = i;
  }
  const missing = t.columns.filter((c) => c.required && idx[c.key] === undefined).map((c) => c.label);
  if (missing.length) {
    throw new HttpError(400, `The file is missing required column(s): ${missing.join(', ')}. Download the template to see the expected layout.`, { missing });
  }
  return idx;
}

/* ------------------------------------------------------------- validation */

function validate(db, type, mode, raw, scope) {
  const depts = new Map(db.all('SELECT id, code FROM departments').map((d) => [d.code.toUpperCase(), d.id]));
  const classKey = (d, y, s, sec) => `${d}|${y}|${s}|${sec}`;
  const classes = new Map(db.all('SELECT id, department_id, year, semester, section FROM classes').map((c) => [classKey(c.department_id, c.year, c.semester, c.section.toUpperCase()), c.id]));
  const seen = new Set();
  const out = [];

  const deptOf = (v, errors) => {
    const code = str(v).toUpperCase();
    const id = depts.get(code);
    if (!id) errors.push(`Unknown department code "${code || '(blank)'}"`);
    else if (scope && id !== scope) errors.push('Department is outside your access');
    return id;
  };
  const yearSem = (r, errors) => {
    const y = parseOrdinal(r.year);
    const s = parseOrdinal(r.semester);
    if (!(y >= 1 && y <= 5)) errors.push(`Invalid year "${r.year}"`);
    if (!(s >= 1 && s <= 10)) errors.push(`Invalid semester "${r.semester}"`);
    else if (y >= 1 && (s < y * 2 - 1 || s > y * 2)) errors.push(`Semester ${s} does not belong to year ${y}`);
    return [y, s];
  };
  const section = (v, errors) => {
    const s = str(v).toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(s)) errors.push(`Invalid section "${v}"`);
    return s;
  };

  raw.forEach((r, i) => {
    const errors = [];
    const rowNo = r.__row || i + 2;
    let key;
    let values;
    let existingId = null;

    if (type === 'departments') {
      const code = str(r.code).toUpperCase();
      if (!/^[A-Z0-9&_-]{1,12}$/.test(code)) errors.push('Department code must be 1–12 letters/numbers');
      if (!str(r.name)) errors.push('Department name is missing');
      key = code;
      values = { code, name: str(r.name) };
      existingId = depts.get(code) || null;
    } else if (type === 'classes') {
      const d = deptOf(r.department, errors);
      const [y, s] = yearSem(r, errors);
      const sec = section(r.section, errors);
      key = classKey(d, y, s, sec);
      values = { department_id: d, year: y, semester: s, section: sec };
      existingId = classes.get(key) || null;
    } else if (type === 'students') {
      const reg = str(r.register_no).toUpperCase();
      if (!reg) errors.push('Register number is missing');
      else if (!/^[A-Z0-9/-]{3,30}$/.test(reg)) errors.push('Register number has invalid characters');
      if (!str(r.name)) errors.push('Student name is missing');
      const d = deptOf(r.department, errors);
      const [y, s] = yearSem(r, errors);
      const sec = section(r.section, errors);
      const classId = classes.get(classKey(d, y, s, sec));
      if (d && y && s && sec && !classId && !errors.length) errors.push(`Class ${str(r.department).toUpperCase()} Y${y} S${s} Sec ${sec} does not exist — import classes first`);
      const adm = str(r.admission_year) ? Number(r.admission_year) : null;
      if (adm !== null && !(Number.isInteger(adm) && adm > 1990 && adm < 2100)) errors.push(`Invalid admission year "${r.admission_year}"`);
      const status = str(r.status).toLowerCase() || 'active';
      if (!['active', 'inactive', 'graduated'].includes(status)) errors.push(`Invalid status "${r.status}"`);
      key = reg;
      values = { register_no: reg, name: str(r.name), department_id: d, class_id: classId, admission_year: adm, status };
      existingId = reg ? db.get('SELECT id FROM students WHERE register_no = ?', reg)?.id || null : null;
    } else if (type === 'faculty') {
      const sid = str(r.staff_id).toUpperCase();
      if (!sid) errors.push('Staff ID is missing');
      if (!str(r.name)) errors.push('Faculty name is missing');
      const d = deptOf(r.department, errors);
      const status = str(r.status).toLowerCase() || 'active';
      if (!['active', 'inactive'].includes(status)) errors.push(`Invalid status "${r.status}"`);
      const email = str(r.email);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(`Invalid email "${email}"`);
      key = sid;
      values = { staff_id: sid, name: str(r.name), department_id: d, designation: str(r.designation) || null, email: email || null, status };
      existingId = sid ? db.get('SELECT id FROM faculty WHERE staff_id = ?', sid)?.id || null : null;
    } else if (type === 'subjects') {
      const code = str(r.code).toUpperCase();
      if (!code) errors.push('Subject code is missing');
      if (!str(r.name)) errors.push('Subject name is missing');
      const d = deptOf(r.department, errors);
      const sem = str(r.semester) ? parseOrdinal(r.semester) : null;
      if (sem !== null && !(sem >= 1 && sem <= 10)) errors.push(`Invalid semester "${r.semester}"`);
      key = code;
      values = { code, name: str(r.name), department_id: d, semester: sem };
      existingId = code ? db.get('SELECT id FROM subjects WHERE code = ?', code)?.id || null : null;
    } else if (type === 'mappings') {
      const d = deptOf(r.department, errors);
      const [y, s] = yearSem(r, errors);
      const sec = section(r.section, errors);
      const fac = db.get('SELECT id, status FROM faculty WHERE staff_id = ?', str(r.staff_id).toUpperCase());
      const sub = db.get('SELECT id, department_id FROM subjects WHERE code = ?', str(r.subject_code).toUpperCase());
      if (!fac) errors.push(`Faculty "${str(r.staff_id)}" does not exist`);
      else if (fac.status !== 'active') errors.push('Faculty is inactive');
      if (!sub) errors.push(`Subject "${str(r.subject_code)}" does not exist`);
      else if (d && sub.department_id !== d) errors.push('Subject belongs to a different department');
      const classId = classes.get(classKey(d, y, s, sec));
      if (d && y && s && sec && !classId) errors.push('Class does not exist');
      key = `${classId}|${sub?.id}|${fac?.id}`;
      values = { class_id: classId, subject_id: sub?.id, faculty_id: fac?.id };
      existingId = classId && sub && fac ? db.get('SELECT id FROM mappings WHERE class_id = ? AND subject_id = ? AND faculty_id = ?', classId, sub.id, fac.id)?.id || null : null;
    } else {
      throw new HttpError(400, 'Unknown import type.');
    }

    if (existingId && scope && ['students', 'faculty', 'subjects'].includes(type)) {
      const owner = db.get(`SELECT department_id FROM ${type} WHERE id = ?`, existingId)?.department_id;
      if (owner !== scope) errors.push('This record exists in another department');
    }

    let status;
    if (errors.length) status = 'invalid';
    else if (seen.has(key)) { status = 'duplicate'; errors.push('Duplicate of an earlier row in this file'); }
    else if (existingId) status = mode === 'update' && type !== 'classes' && type !== 'mappings' ? 'update' : 'exists';
    else status = 'new';
    if (key && !errors.length) seen.add(key);
    out.push({ row: rowNo, status, errors, values, existingId, input: r.__input });
  });
  return out;
}

/* ---------------------------------------------------------- preview/commit */

const pending = new Map(); // token → { type, mode, filename, raw, adminId, expires }

async function preview(db, { type, mode, filename, buffer, scope, admin }) {
  if (!TYPES[type]) throw new HttpError(400, 'Unknown import type.');
  const table = (await readTable(buffer, filename)).filter((r) => r.some((c) => str(c)));
  if (table.length < 2) throw new HttpError(400, 'The file has no data rows below the header.');
  if (table.length > 20001) throw new HttpError(400, 'Please import at most 20,000 rows at a time.');
  const idx = mapHeaders(type, table[0]);
  const raw = table.slice(1).map((cells, i) => {
    const r = { __row: i + 2, __input: cells.map(str) };
    for (const [k, j] of Object.entries(idx)) r[k] = cells[j];
    return r;
  });
  const rows = validate(db, type, mode, raw, scope);
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  pending.set(token, { type, mode, filename, raw, adminId: admin.id, expires: now + 30 * 60e3 });
  return {
    token,
    type,
    mode,
    filename,
    header: table[0].map(str),
    summary: summarize(rows),
    rows: rows.map(({ row, status, errors, input }) => ({ row, status, errors, input })),
  };
}

function summarize(rows) {
  const s = { total: rows.length, new: 0, update: 0, exists: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) s[r.status]++;
  return s;
}

function commit(db, token, admin, scope) {
  const job = pending.get(token);
  if (!job || job.adminId !== admin.id || job.expires < Date.now()) throw new HttpError(410, 'This preview has expired. Please upload the file again.');
  pending.delete(token);
  const { type, mode } = job;

  const result = db.tx(() => {
    // Re-validate inside the transaction so the data can't drift since preview.
    const rows = validate(db, type, mode, job.raw, scope);
    let added = 0;
    let updated = 0;
    const failed = [];
    const table = { departments: 'departments', classes: 'classes', students: 'students', faculty: 'faculty', subjects: 'subjects', mappings: 'mappings' }[type];
    for (const r of rows) {
      if (r.status === 'invalid' || r.status === 'duplicate') { failed.push({ row: r.row, errors: r.errors }); continue; }
      if (r.status === 'exists') continue;
      const cols = Object.keys(r.values);
      if (r.status === 'new') {
        db.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => r.values[c]));
        added++;
      } else if (r.status === 'update') {
        db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => r.values[c]), r.existingId);
        updated++;
      }
    }
    const skipped = rows.filter((r) => r.status === 'exists').length;
    db.run(
      'INSERT INTO import_logs(type, mode, filename, total, added, updated, failed, admin, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      type, mode, job.filename, rows.length, added, updated, failed.length, admin.username, new Date().toISOString(),
    );
    return { type, mode, total: rows.length, added, updated, skipped, failed };
  });
  return result;
}

module.exports = { describe, template, preview, commit, parseCsv, TYPES };
