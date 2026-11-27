'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { seed } = require('../server/seed');
const { createApp } = require('../server/app');

let server;
let base;
let db;

test.before(async () => {
  db = open(':memory:');
  seed(db, { demo: true });
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(path, { method = 'GET', body, headers = {}, cookie, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== 'GET') h['x-afs'] = '1';
  let payload;
  if (body instanceof Buffer) { payload = body; h['content-type'] = 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, data, res };
}

async function login(username, password) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(r.status, 200);
  return r.res.headers.get('set-cookie').split(';')[0];
}

const fullRatings = (v = 8) => Object.fromEntries(db.all('SELECT id FROM questions WHERE active = 1').map((q) => [q.id, v]));

test('public config exposes the ten questions and the open cycle', async () => {
  const { data } = await call('/api/public/config');
  assert.equal(data.questions.length, 10);
  assert.equal(data.questions[0].text, 'How is the faculty’s approach?');
  assert.ok(data.cycle);
  assert.equal(data.requireVerification, true);
});

test('verification rejects unknown register numbers', async () => {
  const r = await call('/api/public/verify', { method: 'POST', body: { register_no: 'ZZZ999' } });
  assert.equal(r.status, 404);
});

test('submission is anonymous, validated and one-per-form', async () => {
  const v = await call('/api/public/verify', { method: 'POST', body: { register_no: '24csbs001' } });
  assert.equal(v.status, 200);
  const token = v.data.token;
  const form = v.data.forms[0];
  assert.equal(form.completed, false);
  const headers = { 'x-student-token': token };

  // out-of-range, too-precise and missing ratings are rejected
  for (const bad of [{ ...fullRatings(), 1: 11 }, { ...fullRatings(), 1: 0.5 }, { ...fullRatings(), 1: 7.25 }, { 1: 8 }]) {
    const r = await call('/api/public/submit', { method: 'POST', headers, body: { mapping_id: form.mapping_id, ratings: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }

  const before = db.get('SELECT COUNT(*) n FROM feedback').n;
  const ok = await call('/api/public/submit', { method: 'POST', headers, body: { mapping_id: form.mapping_id, ratings: { ...fullRatings(7), 1: 9.5 }, comment: 'Great classes' } });
  assert.equal(ok.status, 201);
  assert.equal(db.get('SELECT COUNT(*) n FROM feedback').n, before + 1);

  // duplicate
  const dup = await call('/api/public/submit', { method: 'POST', headers, body: { mapping_id: form.mapping_id, ratings: fullRatings() } });
  assert.equal(dup.status, 409);

  // anonymity: feedback tables carry no student reference
  for (const t of ['feedback', 'feedback_answers']) {
    const cols = db.all(`PRAGMA table_info(${t})`).map((c) => c.name);
    assert.ok(!cols.some((c) => /student|register/i.test(c)), `${t} must not reference students`);
  }
  const cmpCols = db.all('PRAGMA table_info(completions)').map((c) => c.name);
  assert.ok(!cmpCols.some((c) => /rating|feedback|comment/i.test(c)), 'completions must not hold answers');
  // only a date is stored, no time
  const row = db.get("SELECT submitted_on FROM feedback WHERE comment = 'Great classes'");
  assert.match(row.submitted_on, /^\d{4}-\d{2}-\d{2}$/);

  // forms list reflects completion
  const f = await call('/api/public/forms', { headers });
  assert.equal(f.data.forms.find((x) => x.mapping_id === form.mapping_id).completed, true);
});

test('students cannot submit for another class', async () => {
  const v = await call('/api/public/verify', { method: 'POST', body: { register_no: '24CSBS002' } });
  const other = db.get('SELECT m.id FROM mappings m WHERE m.class_id <> ? LIMIT 1', v.data.class.id);
  const r = await call('/api/public/submit', { method: 'POST', headers: { 'x-student-token': v.data.token }, body: { mapping_id: other.id, ratings: fullRatings() } });
  assert.equal(r.status, 403);
});

test('tampered student tokens are rejected', async () => {
  const v = await call('/api/public/verify', { method: 'POST', body: { register_no: '24CSBS003' } });
  const [p, sig] = v.data.token.split('.');
  const forged = Buffer.from(Buffer.from(p, 'base64url').toString().replace(/^\d+/, '1')).toString('base64url') + '.' + sig;
  const r = await call('/api/public/forms', { headers: { 'x-student-token': forged } });
  assert.equal(r.status, 401);
});

test('admin endpoints require auth and the CSRF header', async () => {
  assert.equal((await call('/api/admin/dashboard')).status, 401);
  const bad = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const cookie = await login('admin', 'admin123');
  assert.equal((await call('/api/admin/dashboard', { cookie })).status, 200);
  const noHeader = await fetch(base + '/api/admin/departments', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
});

test('reports: faculty, question and filtered grouping', async () => {
  const cookie = await login('admin', 'admin123');
  const fac = await call('/api/admin/report?group=faculty', { cookie });
  assert.ok(fac.data.rows.length > 5);
  for (const r of fac.data.rows) assert.ok(r.average >= 1 && r.average <= 10);
  const q = await call('/api/admin/report?group=question', { cookie });
  assert.equal(q.data.rows.length, 10);
  const cse = db.get("SELECT id FROM departments WHERE code = 'CSE'").id;
  const dept = await call(`/api/admin/report?group=department&department_id=${cse}`, { cookie });
  assert.equal(dept.data.rows.length, 1);
  assert.equal(dept.data.rows[0].label, 'CSE');
  const resp = await call('/api/admin/responses?limit=5', { cookie });
  assert.equal(resp.data.rows.length, 5);
  assert.equal(Object.keys(resp.data.rows[0].ratings).length, 10);
  assert.ok(!('id' in resp.data.rows[0]));
});

test('excel export returns a filtered workbook', async () => {
  const cookie = await login('admin', 'admin123');
  const res = await call('/api/admin/export?department_id=1', { cookie, raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const names = wb.worksheets.map((w) => w.name);
  for (const n of ['Report', 'Faculty-wise', 'Subject-wise', 'Class-wise', 'Question-wise', 'Responses (anonymous)']) assert.ok(names.includes(n), n);
  const depts = new Set();
  wb.getWorksheet('Responses (anonymous)').eachRow((row, i) => { if (i > 1) depts.add(row.getCell(2).value); });
  assert.deepEqual([...depts], ['CSBS']);
});

test('department admins are scoped to their department', async () => {
  const cookie = await login('hod.cse', 'hod123');
  const cse = db.get("SELECT id FROM departments WHERE code = 'CSE'").id;
  const dept = await call('/api/admin/report?group=department', { cookie });
  assert.deepEqual(dept.data.rows.map((r) => r.label), ['CSE']);
  const st = await call('/api/admin/students', { cookie });
  assert.ok(st.data.rows.every((s) => s.department_id === cse));
  const other = db.get("SELECT id FROM departments WHERE code = 'IT'").id;
  const add = await call('/api/admin/faculty', { method: 'POST', cookie, body: { staff_id: 'X1', name: 'X', department_id: other } });
  assert.equal(add.status, 403);
  assert.equal((await call('/api/admin/admins', { cookie })).status, 403);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', cookie, body: { allow_comments: false } })).status, 403);
});

test('import: preview validates, add mode skips existing, update mode updates', async () => {
  const cookie = await login('admin', 'admin123');
  const csv = [
    'Register Number,Name,Department,Year,Semester,Section',
    '24CSBS001,Renamed Student,CSBS,III,V,A', // exists
    '99CSBS900,New Student,CSBS,3,5,A', // new
    '99CSBS900,Dup Student,CSBS,3,5,A', // duplicate in file
    '99CSBS901,,CSBS,III,V,A', // missing name
    '99CSBS902,Bad Dept,NOPE,III,V,A', // invalid dept
    '99CSBS903,No Class,CSBS,III,V,Z', // class does not exist
    '99CSBS904,Bad Sem,CSBS,III,II,A', // semester not in year
  ].join('\n');
  const p = await call('/api/admin/import/preview?type=students&mode=add&filename=s.csv', { method: 'POST', cookie, body: Buffer.from(csv) });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(p.data.summary, { total: 7, new: 1, update: 0, exists: 1, duplicate: 1, invalid: 4 });
  const c = await call('/api/admin/import/commit', { method: 'POST', cookie, body: { token: p.data.token } });
  assert.equal(c.data.added, 1);
  assert.equal(db.get("SELECT name FROM students WHERE register_no = '24CSBS001'").name !== 'Renamed Student', true);
  // token is single use
  assert.equal((await call('/api/admin/import/commit', { method: 'POST', cookie, body: { token: p.data.token } })).status, 410);

  const p2 = await call('/api/admin/import/preview?type=students&mode=update&filename=s.csv', { method: 'POST', cookie, body: Buffer.from('regno,student name,dept,year,sem,sec\n24CSBS001,Renamed Student,CSBS,III,V,A') });
  assert.equal(p2.data.summary.update, 1);
  await call('/api/admin/import/commit', { method: 'POST', cookie, body: { token: p2.data.token } });
  assert.equal(db.get("SELECT name FROM students WHERE register_no = '24CSBS001'").name, 'Renamed Student');

  const missing = await call('/api/admin/import/preview?type=faculty&mode=add&filename=f.csv', { method: 'POST', cookie, body: Buffer.from('Name,Department\nA,CSE') });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /Staff ID/);
});

test('import: xlsx templates round-trip through preview', async () => {
  const cookie = await login('admin', 'admin123');
  const res = await call('/api/admin/import/template?type=classes', { cookie, raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  const p = await call('/api/admin/import/preview?type=classes&mode=add&filename=t.xlsx', { method: 'POST', cookie, body: buf });
  assert.equal(p.status, 200);
  assert.equal(p.data.summary.total, 2);
});

test('completion tracking counts without exposing answers', async () => {
  const cookie = await login('admin', 'admin123');
  const c = await call('/api/admin/completion', { cookie });
  assert.ok(c.data.expected > 0);
  const cls = await call(`/api/admin/completion/class/${c.data.classes[0].id}`, { cookie });
  assert.ok(cls.data.students.length > 0);
  for (const s of cls.data.students) assert.deepEqual(Object.keys(s).sort(), ['done', 'name', 'register_no']);
});

test('only one cycle can be open', async () => {
  const cookie = await login('admin', 'admin123');
  const r = await call('/api/admin/cycles', { method: 'POST', cookie, body: { name: 'Next', academic_year: '2027-28', term: 'Odd', status: 'open' } });
  assert.equal(r.status, 201);
  assert.equal(db.get("SELECT COUNT(*) n FROM cycles WHERE status = 'open'").n, 1);
  // restore
  db.run("UPDATE cycles SET status = 'closed' WHERE id = ?", r.data.id);
  db.run("UPDATE cycles SET status = 'open' WHERE id = 1");
});
