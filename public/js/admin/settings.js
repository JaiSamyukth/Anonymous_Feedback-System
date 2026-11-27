import { h, clear, icon, api, toast, fmtDate, fmtInt, download } from '../core.js';
import { state, setTop, loadMeta, isSuper } from './shared.js';
import { crudPage, deptOptions, statusChip } from './crud.js';

const statusTone = { open: 'chip-good', draft: 'chip-warn', closed: '' };

/* --------------------------------------------------------------- cycles */
export function cycles(el) {
  return crudPage(el, {
    title: 'Feedback cycles', crumb: 'Configuration', endpoint: '/api/admin/cycles', noun: 'cycle', search: false,
    readOnly: () => !isSuper(),
    intro: h('div.callout', icon('calendar'), h('span', 'A cycle is one round of feedback, e.g. “2026-27 Odd Semester”. Only one cycle can be open at a time — opening a cycle closes the previous one. Students can only submit while a cycle is open.')),
    columns: [
      { key: 'name', label: 'Cycle', strong: true },
      { key: 'academic_year', label: 'Academic year' },
      { key: 'term', label: 'Term' },
      { key: 'status', label: 'Status', render: (r) => h(`span.chip${statusTone[r.status] ? '.' + statusTone[r.status] : ''}`, h('span.dot'), r.status[0].toUpperCase() + r.status.slice(1)) },
      { key: 'opens_on', label: 'Window', render: (r) => `${fmtDate(r.opens_on)} – ${fmtDate(r.closes_on)}` },
      { key: 'responses', label: 'Responses', align: 'right', render: (r) => fmtInt(r.responses) },
    ],
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: '2026-27 Odd Semester Feedback', full: true },
      { name: 'academic_year', label: 'Academic year', required: true, placeholder: '2026-27' },
      { name: 'term', label: 'Term', type: 'select', required: true, options: () => [['Odd', 'Odd semester'], ['Even', 'Even semester']] },
      { name: 'status', label: 'Status', type: 'select', options: () => [['draft', 'Draft'], ['open', 'Open — accepting feedback'], ['closed', 'Closed']], default: 'draft' },
      { name: 'opens_on', label: 'Opens on', type: 'date' },
      { name: 'closes_on', label: 'Closes on', type: 'date' },
    ],
    deleteMessage: (r) => (r.responses ? 'Cycles with responses cannot be deleted. Close the cycle instead.' : 'This cycle has no responses and will be removed.'),
  });
}

/* ------------------------------------------------------------ questions */
export function questions(el) {
  return crudPage(el, {
    title: 'Questionnaire', crumb: 'Configuration', endpoint: '/api/admin/questions', noun: 'question', search: false,
    readOnly: () => !isSuper(),
    intro: h('div.callout', icon('clipboard'), h('span', 'Students rate every active question from 1 to 10 (half points allowed). Deactivate a question instead of deleting it to keep historical reports intact.')),
    columns: [
      { key: 'position', label: '#', render: (r) => h('span.chip', `Q${r.position}`) },
      { key: 'text', label: 'Question', render: (r) => h('div', h('div.cell-strong', r.text), r.short ? h('div.subtle', `Short label: ${r.short}`) : null) },
      { key: 'active', label: 'Status', render: (r) => statusChip(r.active) },
    ],
    fields: [
      { name: 'text', label: 'Question text', type: 'textarea', required: true, full: true },
      { name: 'short', label: 'Short label (for charts)', placeholder: 'Communication' },
      { name: 'position', label: 'Order', type: 'number', required: true, default: () => (state.meta.questions.at(-1)?.position || 0) + 1 },
      { name: 'active', label: 'Status', type: 'switch', switchLabel: 'Shown to students' },
    ],
    deleteMessage: () => 'Questions that already have answers cannot be deleted. Deactivate the question to remove it from future forms.',
  });
}

/* --------------------------------------------------------------- admins */
export function admins(el) {
  return crudPage(el, {
    title: 'Admin users', crumb: 'Configuration', endpoint: '/api/admin/admins', noun: 'admin', search: 'Search username or name…',
    intro: h('div.callout', icon('key'), h('span', 'Super admins manage the whole institution. Department admins (e.g. HODs) can only see and manage data and reports for their own department.')),
    columns: [
      { key: 'username', label: 'Username', render: (r) => h('span.mono.cell-strong', r.username) },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role', render: (r) => h(`span.chip${r.role === 'super_admin' ? '.chip-primary' : ''}`, r.role === 'super_admin' ? 'Super admin' : `Dept admin · ${r.department_code}`) },
      { key: 'last_login', label: 'Last sign-in', render: (r) => (r.last_login ? fmtDate(r.last_login) : h('span.subtle', 'Never')) },
      { key: 'active', label: 'Status', render: (r) => statusChip(r.active) },
    ],
    fields: [
      { name: 'username', label: 'Username', required: true, placeholder: 'hod.cse' },
      { name: 'name', label: 'Full name', required: true },
      { name: 'role', label: 'Role', type: 'select', required: true, options: () => [['super_admin', 'Super admin'], ['dept_admin', 'Department admin']], default: 'dept_admin' },
      { name: 'department_id', label: 'Department', type: 'select', options: deptOptions, hint: 'Required for department admins.' },
      { name: 'password', label: 'Password', type: 'password', required: true, requiredOnCreate: true, optional: true, hint: (row) => (row ? 'Leave blank to keep the current password.' : 'At least 8 characters.') },
      { name: 'active', label: 'Status', type: 'switch', switchLabel: 'Can sign in' },
    ],
    describe: (r) => `@${r.username}`,
  });
}

/* -------------------------------------------------------------- general */
export async function general(el) {
  setTop('Settings', { crumb: 'Configuration' });
  const s = state.meta.settings;
  const name = h('input.input#iname', { value: s.institution_name, maxlength: 150 });
  const short = h('input.input#ishort', { value: s.institution_short, maxlength: 20 });
  const verify = h('input', { type: 'checkbox', checked: s.require_verification });
  const comments = h('input', { type: 'checkbox', checked: s.allow_comments });
  const minResp = h('input.input#minr', { type: 'number', min: 1, max: 50, value: s.min_responses, style: { maxWidth: '120px' } });
  const auth = h('select.select#sauth', { style: { maxWidth: '360px' } },
    h('option', { value: 'dob', selected: s.student_auth !== 'regno' }, 'Register number + date of birth (recommended)'),
    h('option', { value: 'regno', selected: s.student_auth === 'regno' }, 'Register number only (as in the old system)'));
  const rTitle = h('input.input#rtitle', { value: s.report_title || '', maxlength: 300 });
  const rSub = h('input.input#rsub', { value: s.report_subtitle || '', maxlength: 300 });
  const rFoot = h('input.input#rfoot', { value: s.report_footer || '', maxlength: 300 });
  const rSign = h('input.input#rsign', { value: s.report_signatures || '', maxlength: 300 });
  const save = h('button.btn.btn-primary', {
    onclick: async () => {
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { institution_name: name.value, institution_short: short.value, require_verification: verify.checked, allow_comments: comments.checked, min_responses: Number(minResp.value), student_auth: auth.value, report_title: rTitle.value, report_subtitle: rSub.value, report_footer: rFoot.value, report_signatures: rSign.value } });
        await loadMeta();
        toast('Settings saved.');
      } catch (ex) { toast(ex.message, 'bad'); }
    },
  }, 'Save settings');

  const section = (title, desc, ...body) => h('section.card', h('div.card-head', h('div', h('h3', title), h('div.subtle', desc))), h('div.card-body.stack', { style: { '--gap': '16px' } }, ...body));
  clear(el,
    section('Institution', 'Shown on the student portal and on exported reports.',
      h('div.form-grid', h('div.field', h('label', { for: 'iname' }, 'Institution name'), name), h('div.field', h('label', { for: 'ishort' }, 'Short name'), short))),
    section('Student access', 'Control how students reach the feedback forms.',
      h('label.switch', verify, h('span.track'), h('span', h('b', 'Require register number verification'), h('div.subtle', 'Recommended. Students see only their class’s faculty and can submit each form once. Turn off to let anyone pick a department and class (no duplicate protection).'))),
      h('label.switch', comments, h('span.track'), h('span', h('b', 'Allow optional written comments'), h('div.subtle', 'Students can add a short anonymous comment with their ratings.')))),
    section('Student sign-in', 'What students enter to prove they belong to a class.',
      h('div.field', h('label', { for: 'sauth' }, 'Sign-in method'), auth, h('span.hint', 'Date of birth stops someone from submitting with a classmate’s register number. Use “register number only” if dates of birth are not available yet.'))),
    section('Official class report (PDF)', 'Header and footer printed on the class-wise PDF report.',
      h('div.form-grid',
        h('div.field', h('label', { for: 'rsub' }, 'Line under the institution name'), rSub),
        h('div.field', h('label', { for: 'rtitle' }, 'Report title'), rTitle),
        h('div.field', h('label', { for: 'rfoot' }, 'Footer (form number etc.)'), rFoot),
        h('div.field', h('label', { for: 'rsign' }, 'Signature lines (comma-separated)'), rSign))),
    section('Reporting', 'How results are presented to administrators.',
      h('div.field', h('label', { for: 'minr' }, 'Low-sample threshold (responses)'), minResp, h('span.hint', 'Groups with fewer responses than this are flagged as “Low sample”, and faculty below it are left out of the dashboard rankings.'))),
    section('Backup & archive', 'Feedback is kept per cycle, so starting a new cycle replaces the old “archive and reset”. Download a full backup any time.',
      h('div.row', h('button.btn', { onclick: async () => { try { await download('/api/admin/backup', 'feedback-backup.db'); toast('Backup downloaded.'); } catch (ex) { toast(ex.message, 'bad'); } } }, icon('download'), 'Download full backup (.db)'),
        h('a.btn.btn-ghost', { href: '#/cycles' }, icon('calendar'), 'Manage feedback cycles'))),
    h('div', save));
}
