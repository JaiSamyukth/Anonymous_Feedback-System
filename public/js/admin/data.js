import { h, clear, icon, api, qs, toast, roman, fmtInt, fmtDate, download } from '../core.js';
import { state, setTop, loadMeta, isSuper } from './shared.js';
import { crudPage, deptOptions, deptDefault, classOptions, statusChip } from './crud.js';
import { dataTable } from './table.js';

const YEARS = [[1, 'I Year'], [2, 'II Year'], [3, 'III Year'], [4, 'IV Year'], [5, 'V Year']];
const SEMS = Array.from({ length: 10 }, (_, i) => [i + 1, `Semester ${roman(i + 1)}`]);
const DESIGNATIONS = ['Professor', 'Associate Professor', 'Assistant Professor', 'Professor & Head', 'Lecturer', 'Guest Faculty'];
const deptToolbar = () => (isSuper() ? [{ name: 'department_id', label: 'All departments', options: () => state.meta.departments.map((d) => [d.id, d.code]) }] : []);
const importLink = (type) => () => h('a.btn.btn-sm', { href: `#/import/${type}` }, icon('upload'), 'Import');

/* --------------------------------------------------------- departments */
export function departments(el) {
  return crudPage(el, {
    title: 'Departments', crumb: 'Academic data', endpoint: '/api/admin/departments', noun: 'department',
    search: 'Search code or name…',
    headerActions: importLink('departments'),
    readOnly: () => !isSuper(),
    columns: [
      { key: 'code', label: 'Code', render: (r) => h('span.chip.chip-primary', r.code) },
      { key: 'name', label: 'Department', strong: true },
      { key: 'classes', label: 'Classes', align: 'right' },
      { key: 'students', label: 'Students', align: 'right', render: (r) => fmtInt(r.students) },
      { key: 'faculty', label: 'Faculty', align: 'right' },
      { key: 'active', label: 'Status', render: (r) => statusChip(r.active) },
    ],
    fields: [
      { name: 'code', label: 'Code', required: true, placeholder: 'e.g. CSBS', upper: true },
      { name: 'name', label: 'Department name', required: true, placeholder: 'Computer Science and Business Systems', full: true },
      { name: 'active', label: 'Status', type: 'switch', hint: 'Inactive departments are hidden from students.' },
    ],
    describe: (r) => r.name,
  });
}

/* -------------------------------------------------------------- classes */
export function classes(el) {
  return crudPage(el, {
    title: 'Classes & sections', crumb: 'Academic data', endpoint: '/api/admin/classes', noun: 'class', nounPlural: 'classes',
    search: 'Search department or section…',
    headerActions: importLink('classes'),
    toolbar: deptToolbar(),
    intro: h('div.callout', icon('info'), h('span', 'A class is a department + year + semester + section. Students belong to a class, and the faculty mapping decides which faculty-subject forms each class sees.')),
    columns: [
      { key: 'label', label: 'Class', strong: true, sort: (r) => `${r.department_code}${r.year}${r.semester}${r.section}` },
      { key: 'department_code', label: 'Dept' },
      { key: 'year', label: 'Year', render: (r) => `${roman(r.year)}` },
      { key: 'semester', label: 'Semester', render: (r) => roman(r.semester) },
      { key: 'section', label: 'Section' },
      { key: 'students', label: 'Students', align: 'right' },
      { key: 'mappings', label: 'Faculty-subjects', align: 'right', render: (r) => (r.mappings ? r.mappings : h('span.chip.chip-warn', 'None')) },
      { key: 'active', label: 'Status', render: (r) => statusChip(r.active) },
    ],
    fields: [
      { name: 'department_id', label: 'Department', type: 'select', required: true, options: deptOptions, default: deptDefault, full: true },
      { name: 'year', label: 'Year', type: 'select', required: true, options: () => YEARS },
      { name: 'semester', label: 'Semester', type: 'select', required: true, dependsOn: ['year'], options: (v) => SEMS.filter(([s]) => !v.year || s === v.year * 2 - 1 || s === v.year * 2) },
      { name: 'section', label: 'Section', required: true, placeholder: 'A', upper: true },
      { name: 'active', label: 'Status', type: 'switch' },
    ],
    describe: (r) => r.label,
  });
}

/* ------------------------------------------------------------- students */
export function students(el) {
  return crudPage(el, {
    title: 'Students', crumb: 'Academic data', endpoint: '/api/admin/students', noun: 'student',
    search: 'Search register number or name…',
    headerActions: importLink('students'),
    toolbar: [
      ...deptToolbar(),
      { name: 'class_id', label: 'All classes', options: () => classOptions(null) },
      { name: 'status', label: 'Any status', options: () => [['active', 'Active'], ['inactive', 'Inactive'], ['graduated', 'Graduated']] },
    ],
    intro: h('div.callout', icon('shield'), h('span', 'Student records are used only to check eligibility and track completion. They are never stored alongside feedback answers.')),
    columns: [
      { key: 'register_no', label: 'Register no.', render: (r) => h('span.mono.cell-strong', r.register_no) },
      { key: 'name', label: 'Name' },
      { key: 'department_code', label: 'Dept' },
      { key: 'class', label: 'Class', sort: (r) => `${r.year}${r.semester}${r.section}`, export: (r) => (r.year ? `${roman(r.year)} Year - Sem ${roman(r.semester)} - ${r.section}` : ''), render: (r) => (r.year ? `${roman(r.year)} · Sem ${roman(r.semester)} · ${r.section}` : h('span.chip.chip-warn', 'Unassigned')) },
      { key: 'dob', label: 'Date of birth', render: (r) => (r.dob ? fmtDate(r.dob) : h('span.chip.chip-bad', 'Missing')) },
      { key: 'admission_year', label: 'Batch' },
      { key: 'status', label: 'Status', render: (r) => statusChip(r.status) },
    ],
    fields: [
      { name: 'register_no', label: 'Register number', required: true, upper: true, placeholder: '24CSBS001' },
      { name: 'name', label: 'Full name', required: true },
      { name: 'department_id', label: 'Department', type: 'select', required: true, options: deptOptions, default: deptDefault },
      { name: 'class_id', label: 'Class', type: 'select', dependsOn: ['department_id'], options: (v) => classOptions(v.department_id), placeholder: 'Not assigned' },
      { name: 'dob', label: 'Date of birth', type: 'date', required: true, hint: 'Students sign in with their register number and date of birth.' },
      { name: 'admission_year', label: 'Admission year', type: 'number', placeholder: String(new Date().getFullYear()) },
      { name: 'status', label: 'Status', type: 'select', options: () => [['active', 'Active'], ['inactive', 'Inactive'], ['graduated', 'Graduated']], default: 'active' },
    ],
    describe: (r) => `${r.register_no} · ${r.name}`,
    bulk: (sel, done) => {
      const run = async (body, msg) => {
        try {
          const r = await api('/api/admin/students/bulk', { method: 'POST', body: { ids: sel.map((s) => s.id), ...body } });
          toast(`${r.updated} ${msg}`);
          done();
        } catch (ex) { toast(ex.message, 'bad'); }
      };
      const depts = new Set(sel.map((s) => s.department_id));
      const moveSel = h('select.select', { 'aria-label': 'Move to class', disabled: depts.size > 1, onchange: (e) => e.target.value && run({ action: 'move', class_id: e.target.value }, 'students moved.') },
        h('option', { value: '' }, depts.size > 1 ? 'Select one department to move' : 'Move to class…'),
        depts.size === 1 ? classOptions([...depts][0]).map(([v, l]) => h('option', { value: v }, l)) : null);
      const statusSel = h('select.select', { 'aria-label': 'Set status', onchange: (e) => e.target.value && run({ action: 'status', status: e.target.value }, 'students updated.') },
        h('option', { value: '' }, 'Set status…'), ['active', 'inactive', 'graduated'].map((s) => h('option', { value: s }, s[0].toUpperCase() + s.slice(1))));
      return [moveSel, statusSel];
    },
  });
}

/* -------------------------------------------------------------- faculty */
export function faculty(el) {
  return crudPage(el, {
    title: 'Faculty', crumb: 'Academic data', endpoint: '/api/admin/faculty', noun: 'faculty member', nounPlural: 'faculty members',
    search: 'Search name, staff ID or designation…',
    headerActions: importLink('faculty'),
    toolbar: [...deptToolbar(), { name: 'status', label: 'Any status', options: () => [['active', 'Active'], ['inactive', 'Inactive']] }],
    columns: [
      { key: 'staff_id', label: 'Staff ID', render: (r) => h('span.mono', r.staff_id) },
      { key: 'name', label: 'Name', strong: true },
      { key: 'designation', label: 'Designation' },
      { key: 'department_code', label: 'Dept' },
      { key: 'mappings', label: 'Classes taught', align: 'right' },
      { key: 'status', label: 'Status', render: (r) => statusChip(r.status) },
      { key: 'portal_ready', label: 'Portal', export: (r) => (r.portal_ready ? 'Password set' : 'Initial (Staff ID)'), render: (r) => (r.portal_ready ? h('span.chip.chip-good', { title: r.last_login ? `Last sign-in ${fmtDate(r.last_login)}` : '' }, h('span.dot'), 'Password set') : h('span.chip', { title: 'Can sign in with their Staff ID as password, then must change it' }, 'Initial')) },
      { key: 'report', label: '', sort: false, render: (r) => h('a.btn.btn-soft.btn-sm', { href: `#/faculty-report/${r.id}`, onclick: (e) => e.stopPropagation() }, icon('chart'), 'Insights') },
    ],
    fields: [
      { name: 'staff_id', label: 'Staff ID', required: true, upper: true, placeholder: 'FAC201' },
      { name: 'name', label: 'Full name', required: true, placeholder: 'Dr. Faculty Name' },
      { name: 'department_id', label: 'Department', type: 'select', required: true, options: deptOptions, default: deptDefault },
      { name: 'designation', label: 'Designation', datalist: DESIGNATIONS, placeholder: 'Assistant Professor' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'name@college.edu' },
      { name: 'status', label: 'Status', type: 'select', options: () => [['active', 'Active'], ['inactive', 'Inactive']], default: 'active' },
      { name: 'password', label: 'Faculty portal password', type: 'password', optional: true, full: true, placeholder: 'Leave blank to keep / use Staff ID', hint: 'Optional. New faculty can sign in at /faculty with their Staff ID as the initial password and must change it. A password set here is temporary too.' },
      { name: 'reset_password', label: 'Reset portal password', type: 'switch', default: 0, switchLabel: 'Reset to Staff ID on save', optional: true, hidden: (v, row) => !row },
    ],
    describe: (r) => `${r.name} · ${r.staff_id}`,
    deleteMessage: () => 'Faculty with feedback cannot be deleted — mark them inactive to hide them from students while keeping their reports.',
  });
}

/* ------------------------------------------------------------- subjects */
export function subjects(el) {
  return crudPage(el, {
    title: 'Subjects', crumb: 'Academic data', endpoint: '/api/admin/subjects', noun: 'subject',
    search: 'Search code or name…',
    headerActions: importLink('subjects'),
    toolbar: [...deptToolbar(), { name: 'semester', label: 'Any semester', options: () => SEMS }],
    columns: [
      { key: 'code', label: 'Code', render: (r) => h('span.mono.cell-strong', r.code) },
      { key: 'name', label: 'Subject', strong: true },
      { key: 'department_code', label: 'Dept' },
      { key: 'semester', label: 'Semester', render: (r) => (r.semester ? roman(r.semester) : '—') },
      { key: 'active', label: 'Status', render: (r) => statusChip(r.active) },
    ],
    fields: [
      { name: 'code', label: 'Subject code', required: true, upper: true, placeholder: 'CS3501' },
      { name: 'name', label: 'Subject name', required: true, placeholder: 'Data Structures' },
      { name: 'department_id', label: 'Department', type: 'select', required: true, options: deptOptions, default: deptDefault },
      { name: 'semester', label: 'Semester', type: 'select', options: () => SEMS, placeholder: 'Any' },
      { name: 'active', label: 'Status', type: 'switch' },
    ],
    describe: (r) => `${r.code} · ${r.name}`,
  });
}

/* ------------------------------------------------------------- mappings */
export function mappings(el) {
  const classDept = (id) => state.meta.classes.find((c) => c.id === Number(id))?.department_id;
  return crudPage(el, {
    title: 'Faculty mapping', crumb: 'Academic data', endpoint: '/api/admin/mappings', noun: 'assignment',
    search: 'Search subject or faculty…',
    headerActions: importLink('mappings'),
    toolbar: [...deptToolbar(), { name: 'class_id', label: 'All classes', options: () => classOptions(null) }],
    intro: h('div.callout', icon('link'), h('span', 'Assign who teaches which subject to which class. Students only see the faculty-subject pairs mapped to their own class.')),
    columns: [
      { key: 'class', label: 'Class', sort: (r) => `${r.department_code}${r.year}${r.semester}${r.section}`, export: (r) => `${r.department_code} ${roman(r.year)} Year Sem ${roman(r.semester)} ${r.section}`, render: (r) => h('span.cell-strong', `${r.department_code} · ${roman(r.year)} · Sem ${roman(r.semester)} · ${r.section}`) },
      { key: 'subject_name', label: 'Subject', render: (r) => h('div', h('div', r.subject_name), h('div.subtle.mono', r.subject_code)) },
      { key: 'faculty_name', label: 'Faculty', render: (r) => h('div', h('div', r.faculty_name), h('div.subtle.mono', r.staff_id)) },
    ],
    fields: [
      { name: 'class_id', label: 'Class', type: 'select', required: true, options: () => classOptions(null), full: true },
      { name: 'subject_id', label: 'Subject', type: 'select', required: true, dependsOn: ['class_id'], options: (v) => state.meta.subjects.filter((s) => !v.class_id || s.department_id === classDept(v.class_id)).map((s) => [s.id, `${s.name} (${s.code})`]), full: true },
      { name: 'faculty_id', label: 'Faculty', type: 'select', required: true, options: () => state.meta.faculty.filter((f) => f.status === 'active').map((f) => [f.id, `${f.name} (${f.staff_id})`]), full: true, hint: 'Faculty from any department can be assigned.' },
    ],
    describe: (r) => `${r.subject_name} · ${r.faculty_name}`,
    deleteMessage: () => 'Students in this class will no longer see this form. Feedback already submitted is kept for reporting.',
  });
}

/* =============================================================== import */
const TYPE_INFO = {
  departments: ['building', 'Department ID/code and name.'],
  classes: ['layers', 'Department, year, semester and section.'],
  students: ['graduation', 'Register number, name, department and class.'],
  faculty: ['users', 'Staff ID, name, department and designation.'],
  subjects: ['book', 'Subject code, name and department.'],
  mappings: ['link', 'Faculty ID, subject code and the class they teach.'],
};

export async function importer(el, preset) {
  setTop('Data import', { crumb: 'Academic data' });
  const types = (await api('/api/admin/import/types')).filter((t) => isSuper() || t.key !== 'departments');
  const st = { step: 1, type: types.find((t) => t.key === preset)?.key || null, mode: 'add', file: null, preview: null, result: null, filter: 'all' };
  const steps = h('ol');
  const panel = h('div.card-body');
  const history = h('div');

  el.append(
    h('section.card', h('div.card-head', h('nav.steps', { 'aria-label': 'Import progress' }, steps)), panel),
    h('section.card', h('div.card-head', h('h3', 'Recent imports')), history),
    h('div.callout', icon('info'), h('span', 'Recommended order for a new institution: Departments → Classes → Faculty → Subjects → Faculty mapping → Students. Imports only add or update records — they never delete existing data.')));

  const STEP_NAMES = ['Choose data', 'Upload file', 'Review', 'Done'];
  function paintSteps() {
    clear(steps, STEP_NAMES.map((n, i) => h('li', { class: i + 1 === st.step ? 'on' : i + 1 < st.step ? 'done' : '' }, n)));
  }

  function render() {
    paintSteps();
    if (st.step === 1) return stepType();
    if (st.step === 2) return stepUpload();
    if (st.step === 3) return stepPreview();
    return stepDone();
  }

  function stepType() {
    clear(panel, h('div.stack', { style: { '--gap': '16px' } },
      h('div', h('h3', 'What would you like to import?'), h('p.subtle', 'Excel (.xlsx) and CSV files are supported. Download a template to get the column layout right.')),
      h('div.type-grid', types.map((t) => h('button.type-card', { 'aria-pressed': String(st.type === t.key), onclick: () => { st.type = t.key; st.step = 2; render(); } },
        h('span.ico', icon(TYPE_INFO[t.key][0])), h('b', t.title), h('small', TYPE_INFO[t.key][1]))))));
  }

  function stepUpload() {
    const t = types.find((x) => x.key === st.type);
    const fileInput = h('input', { type: 'file', accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hidden: true, onchange: (e) => pick(e.target.files[0]) });
    const fileLabel = h('div.subtle', st.file ? `${st.file.name} · ${(st.file.size / 1024).toFixed(1)} KB` : 'Drag a file here or click to browse');
    const zone = h('div.dropzone', { tabIndex: 0, role: 'button', 'aria-label': 'Choose a file to upload', onclick: () => fileInput.click(), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click(),
      ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); }, ondragleave: () => zone.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); pick(e.dataTransfer.files[0]); } },
    icon('upload'), h('b', st.file ? 'File ready' : 'Upload CSV or Excel'), fileLabel, fileInput);
    const err = h('div.callout.bad.hidden', { role: 'alert' });
    const next = h('button.btn.btn-primary', { disabled: !st.file, onclick: upload }, 'Validate & preview', icon('arrowRight'));
    function pick(f) {
      if (!f) return;
      if (!/\.(csv|xlsx)$/i.test(f.name)) { toast('Please choose a .csv or .xlsx file.', 'bad'); return; }
      st.file = f;
      fileLabel.textContent = `${f.name} · ${(f.size / 1024).toFixed(1)} KB`;
      next.disabled = false;
    }
    async function upload() {
      next.disabled = true;
      clear(next, h('span.spinner'), 'Validating…');
      err.classList.add('hidden');
      try {
        const buf = await st.file.arrayBuffer();
        st.preview = await api(`/api/admin/import/preview${qs({ type: st.type, mode: st.mode, filename: st.file.name })}`, { method: 'POST', body: buf });
        st.step = 3;
        st.filter = 'all';
        render();
      } catch (ex) {
        clear(err, icon('alert'), h('span', ex.message));
        err.classList.remove('hidden');
        next.disabled = false;
        clear(next, 'Validate & preview', icon('arrowRight'));
      }
    }
    const modeBtn = (m, label, sub) => h('button.type-card', { 'aria-pressed': String(st.mode === m), onclick: () => { st.mode = m; stepUpload(); } }, h('b', label), h('small', sub));
    clear(panel, h('div.stack', { style: { '--gap': '18px' } },
      h('div.spread', h('div', h('h3', `Import ${t.title.toLowerCase()}`), h('p.subtle', 'Required columns: ', t.columns.filter((c) => c.required).map((c) => c.label).join(', '), t.columns.some((c) => !c.required) ? ` · Optional: ${t.columns.filter((c) => !c.required).map((c) => c.label).join(', ')}` : '')),
        h('button.btn.btn-soft.btn-sm', { onclick: () => download(`/api/admin/import/template?type=${st.type}`, `${st.type}-template.xlsx`) }, icon('download'), 'Download template')),
      zone,
      st.type !== 'classes' && st.type !== 'mappings'
        ? h('div', h('div.label', { style: { marginBottom: '8px' } }, 'Import mode'), h('div.type-grid',
            modeBtn('add', 'Add new records only', 'Rows that already exist (matched by their unique ID) are skipped.'),
            modeBtn('update', 'Add & update existing', 'Existing records are updated using their unique ID — no duplicates are created.')))
        : null,
      err,
      h('div.spread', h('button.btn.btn-ghost', { onclick: () => { st.step = 1; st.file = null; render(); } }, icon('arrowLeft'), 'Back'), next)));
  }

  function stepPreview() {
    const p = st.preview;
    const s = p.summary;
    const actionable = s.new + s.update;
    const chips = [
      ['all', 'Total rows', s.total],
      ['new', 'New', s.new],
      ['update', 'Will update', s.update],
      ['exists', 'Already exist (skipped)', s.exists],
      ['duplicate', 'Duplicates', s.duplicate],
      ['invalid', 'Invalid', s.invalid],
    ].filter(([k, , n]) => k === 'all' || n > 0);
    const tone = { new: 'chip-good', update: 'chip-primary', exists: '', duplicate: 'chip-warn', invalid: 'chip-bad' };
    const label = { new: 'New', update: 'Update', exists: 'Exists', duplicate: 'Duplicate', invalid: 'Invalid' };
    const rows = st.filter === 'all' ? p.rows : p.rows.filter((r) => r.status === st.filter);
    const commitBtn = h('button.btn.btn-primary', { disabled: !actionable, onclick: commit }, icon('check'), actionable ? `Import ${actionable} record${actionable === 1 ? '' : 's'}` : 'Nothing to import');
    async function commit() {
      commitBtn.disabled = true;
      clear(commitBtn, h('span.spinner'), 'Importing…');
      try {
        st.result = await api('/api/admin/import/commit', { method: 'POST', body: { token: p.token } });
        st.step = 4;
        await loadMeta();
        render();
        loadHistory();
      } catch (ex) {
        toast(ex.message, 'bad');
        if (ex.status === 410) { st.step = 2; render(); }
      }
    }
    clear(panel, h('div.stack', { style: { '--gap': '16px' } },
      h('div', h('h3', 'Review before importing'), h('p.subtle', `${p.filename} · ${p.mode === 'update' ? 'Add & update existing' : 'Add new only'} · nothing is saved until you confirm.`)),
      h('div.sum-chips', chips.map(([k, l, n]) => h('button.sum-chip', { 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; stepPreview(); } }, h('b', fmtInt(n)), h('span', l)))),
      s.invalid || s.duplicate ? h('div.callout.warn', icon('alert'), h('span', `${s.invalid + s.duplicate} row(s) have problems and will be skipped. Fix them in your file and import again, or continue with the valid rows.`)) : null,
      h('div.card', { style: { maxHeight: '420px', overflow: 'auto' } }, dataTable({
        columns: [
          { key: 'row', label: 'Row', align: 'right' },
          { key: 'status', label: 'Status', render: (r) => h(`span.chip${tone[r.status] ? '.' + tone[r.status] : ''}`, label[r.status]) },
          ...p.header.map((hd, i) => ({ key: `c${i}`, label: hd || `Column ${i + 1}`, sort: (r) => r.input[i], render: (r) => r.input[i] ?? '' })),
          { key: 'errors', label: 'Problems', sort: false, render: (r) => (r.errors.length ? h('ul.errs', r.errors.map((e) => h('li', e))) : h('span.subtle', '—')) },
        ],
        rows: rows.slice(0, 1000),
        empty: 'No rows in this category.',
      })),
      rows.length > 1000 ? h('p.subtle', `Showing the first 1,000 of ${fmtInt(rows.length)} rows.`) : null,
      h('div.spread', h('button.btn.btn-ghost', { onclick: () => { st.step = 2; render(); } }, icon('arrowLeft'), 'Choose another file'), commitBtn)));
  }

  function stepDone() {
    const r = st.result;
    clear(panel, h('div.stack', { style: { '--gap': '16px', alignItems: 'flex-start' } },
      h('div.row', h('span', { style: { width: '48px', height: '48px', borderRadius: '16px', display: 'grid', placeItems: 'center', background: 'var(--good-bg)', color: 'var(--good)' } }, icon('check')),
        h('div', h('h3', 'Import complete'), h('p.subtle', `${types.find((t) => t.key === r.type).title} · ${r.total} rows processed`))),
      h('div.sum-chips',
        h('div.sum-chip', h('b', fmtInt(r.added)), h('span', 'Added')),
        h('div.sum-chip', h('b', fmtInt(r.updated)), h('span', 'Updated')),
        h('div.sum-chip', h('b', fmtInt(r.skipped)), h('span', 'Skipped (existing)')),
        h('div.sum-chip', h('b', fmtInt(r.failed.length)), h('span', 'Failed'))),
      r.failed.length ? h('details', h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, `Show ${r.failed.length} failed row(s)`),
        h('ul.errs', { style: { marginTop: '8px' } }, r.failed.slice(0, 200).map((f) => h('li', `Row ${f.row}: ${f.errors.join('; ')}`)))) : null,
      h('div.row',
        h('button.btn.btn-primary', { onclick: () => { Object.assign(st, { step: 1, type: null, file: null, preview: null, result: null }); render(); } }, 'Import more data'),
        h('a.btn', { href: `#/${r.type === 'faculty' ? 'faculty' : r.type}` }, `View ${r.type}`))));
  }

  async function loadHistory() {
    const rows = await api('/api/admin/imports');
    clear(history, dataTable({
      columns: [
        { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at) },
        { key: 'type', label: 'Data', render: (r) => types.find((t) => t.key === r.type)?.title || r.type },
        { key: 'filename', label: 'File', render: (r) => h('span.mono', r.filename) },
        { key: 'mode', label: 'Mode', render: (r) => (r.mode === 'update' ? 'Add & update' : 'Add only') },
        { key: 'added', label: 'Added', align: 'right' },
        { key: 'updated', label: 'Updated', align: 'right' },
        { key: 'failed', label: 'Failed', align: 'right', render: (r) => (r.failed ? h('span.chip.chip-bad', r.failed) : '0') },
        { key: 'admin', label: 'By' },
      ],
      rows,
      empty: 'No imports yet.',
      emptyIcon: 'upload',
    }));
  }

  if (st.type) st.step = 2;
  render();
  loadHistory();
}

