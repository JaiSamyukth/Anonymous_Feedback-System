import { h, clear, icon, api, qs, fmt, fmtInt, fmtDate, bandChip, avatar, scoreBar, download, toast, modal } from '../core.js';
import { hbar, columns, line } from '../charts.js';
import { state, setTop, filterBar, filterQuery, loading, defaultPasswordBanner } from './shared.js';
import { dataTable } from './table.js';

const card = (title, sub, body, actions) =>
  h('section.card', h('div.card-head', h('div', h('h3', title), sub ? h('div.subtle', sub) : null), actions || null), h('div.card-body', body));

function kpi(ic, label, value, foot, meter) {
  return h('div.card.kpi',
    h('div.k-label', h('span.ico', icon(ic)), label),
    h('div.k-value', value),
    meter !== undefined ? h('div.meter', h('i', { style: { width: `${Math.min(100, meter)}%` } })) : null,
    foot ? h('div.k-foot', foot) : null);
}

function exportButton(keys) {
  const b = h('button.btn.btn-primary.btn-sm', {
    onclick: async () => {
      b.disabled = true;
      try {
        await download(`/api/admin/export${qs(filterQuery(keys))}`, 'feedback-report.xlsx');
        toast('Excel report downloaded.');
      } catch (ex) { toast(ex.message, 'bad'); }
      b.disabled = false;
    },
  }, icon('download'), 'Export Excel');
  return b;
}

/* ============================================================ dashboard */
export async function dashboard(el) {
  setTop('Dashboard', { crumb: state.me.institution });
  const KEYS = ['cycle', 'department', 'year', 'semester', 'section'];
  const body = h('div.stack', { style: { '--gap': '20px' } });
  el.append(defaultPasswordBanner() || '', filterBar(KEYS, load, { extra: [exportButton(KEYS)] }), body);

  async function load() {
    loading(body, 360);
    const d = await api(`/api/admin/dashboard${qs(filterQuery(KEYS))}`);
    const t = d.totals;
    const c = d.completion;
    const ranks = (list, empty) => list.length
      ? h('ul.rank', list.map((r) => h('li', { onclick: () => (location.hash = `#/faculty-report/${r.id}`), tabIndex: 0, onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/faculty-report/${r.id}`) },
          avatar(r.name), h('div', h('b', r.name), h('small', `${r.department_code} · ${r.responses} responses`)), h('span.val', fmt(r.average)))))
      : h('p.subtle', empty);

    clear(body,
      h('div.kpis',
        kpi('message', 'Responses', fmtInt(t.responses), d.cycle ? d.cycle.name : 'All cycles'),
        kpi('sparkles', 'Average rating', [fmt(t.average), h('small', ' / 10')], t.responses ? bandChip(t.average) : 'No responses yet'),
        c ? kpi('target', 'Form completion', [fmt(c.rate, 1), h('small', '%')], `${fmtInt(c.completed)} of ${fmtInt(c.expected)} forms`, c.rate) : null,
        c ? kpi('graduation', 'Students finished', [fmtInt(c.students_done), h('small', ` / ${fmtInt(c.students)}`)], `${fmtInt(c.students_started)} have started`, c.students ? (c.students_done / c.students) * 100 : 0) : null,
        kpi('users', 'Faculty rated', [fmtInt(d.facultyRated), h('small', ` / ${fmtInt(d.facultyCount)}`)], `with ≥ ${d.minResponses} responses`)),
      t.responses === 0
        ? h('div.card.empty', icon('chart'), h('h3', 'No feedback yet for this selection'), h('p', 'Once students start submitting, averages and charts will appear here.'))
        : [
          h('div.grid-3',
            card('Question-wise averages', 'Average score for each of the ten questions', [
              hbar(d.questions.map((q) => ({ label: `Q${q.position} ${q.short || ''}`, value: q.average, tip: q.text })), { labelWidth: 190 }),
            ]),
            h('div.stack', { style: { '--gap': '20px' } },
              card('Top rated', `Faculty with ≥ ${d.minResponses} responses`, ranks(d.top, 'Not enough responses yet.')),
              card('Needs attention', 'Lowest averages in this selection', ranks(d.attention, 'Not enough faculty to compare yet.')))),
          h('div.grid-2',
            card('Department averages', 'Hover for completion rate', hbar(d.byDepartment.map((r) => ({ label: r.code, value: r.average, tip: r.name, extra: `${r.responses} responses${r.completion !== null ? ` · ${r.completion}% complete` : ''}` })), { labelWidth: 90 })),
            card('Submissions per day', 'Dates only — no times are stored', columns(d.daily.map((r) => ({ label: fmtDate(r.day).split(' ').slice(0, 2).join(' '), value: r.responses, tip: fmtDate(r.day) })), { unit: ' responses' }))),
          d.trend.length > 1 ? card('Trend across feedback cycles', 'Average rating per cycle for this selection', line(d.trend.map((r) => ({ label: `${r.academic_year} ${r.term}`, value: r.average, tip: r.name, extra: `${r.responses} responses` })), { min: Math.max(0, Math.floor(Math.min(...d.trend.map((r) => r.average)) - 1)), max: 10 })) : null,
        ]);
  }
  await load();
}

/* ============================================================== reports */
const GROUPS = [
  ['faculty', 'Faculty-wise'],
  ['subject', 'Subject-wise'],
  ['class', 'Class-wise'],
  ['section', 'Section-wise'],
  ['department', 'Department-wise'],
  ['question', 'Question-wise'],
  ['semester', 'Semester-wise'],
  ['academic_year', 'Academic year-wise'],
];

export async function reports(el) {
  setTop('Reports', { crumb: 'Feedback' });
  const KEYS = ['cycle', 'department', 'year', 'semester', 'section', 'faculty', 'subject'];
  let group = sessionStorage.getItem('afs-group') || 'faculty';
  const tabs = h('div.tabs', { role: 'tablist' });
  const body = h('div');
  const paintTabs = () => clear(tabs, GROUPS.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': String(k === group), onclick: () => { group = k; sessionStorage.setItem('afs-group', k); paintTabs(); load(); } }, label)));
  paintTabs();
  el.append(filterBar(KEYS, load, { extra: [exportButton(KEYS)] }), h('section.card', tabs, body));

  async function load() {
    loading(body, 300);
    const r = await api(`/api/admin/report${qs({ ...filterQuery(KEYS), group })}`);
    const o = r.overall;
    const summary = h('div.spread', { style: { padding: '16px 20px', borderBottom: '1px solid var(--border)' } },
      h('div.row', { style: { '--gap': '18px' } },
        h('div', h('div.subtle', 'Responses'), h('b.num', { style: { fontSize: '1.3rem' } }, fmtInt(o.responses))),
        h('div', h('div.subtle', 'Overall average'), h('b.num', { style: { fontSize: '1.3rem' } }, fmt(o.average))),
        o.responses ? bandChip(o.average) : null),
      h('div.subtle', ['academic_year', 'semester'].includes(group) ? 'Comparing across all cycles' : `Low-sample threshold: ${r.minResponses} responses`));

    if (!r.rows.length) {
      clear(body, summary, h('div.empty', icon('chart'), h('h3', 'No feedback matches these filters'), h('p', 'Try widening the filters or choosing another cycle.')));
      return;
    }
    const lowChip = (row) => (row.lowSample ? h('span.chip', { title: 'Fewer responses than the low-sample threshold — interpret with care' }, 'Low sample') : null);
    const stat = [
      { key: 'responses', label: 'Responses', align: 'right', render: (x) => fmtInt(x.responses) },
      { key: 'average', label: 'Average', render: (x) => scoreBar(x.average) },
      { key: 'band', label: 'Rating', sort: (x) => x.average, render: (x) => h('div.row', { style: { '--gap': '6px' } }, bandChip(x.average), lowChip(x)) },
    ];
    const colsByGroup = {
      faculty: [
        { key: 'label', label: 'Faculty', strong: true, render: (x) => h('div.row', { style: { '--gap': '10px', flexWrap: 'nowrap' } }, avatar(x.label, 34), h('div', h('div.cell-strong', x.label), h('div.subtle', `${x.sub} · ${x.designation || ''}`))) },
        { key: 'department_code', label: 'Dept' },
        { key: 'subjects', label: 'Subjects', align: 'right' },
        ...stat,
      ],
      subject: [
        { key: 'label', label: 'Subject', render: (x) => h('div', h('div.cell-strong', x.label), h('div.subtle.mono', x.sub)) },
        { key: 'department_code', label: 'Dept' },
        { key: 'faculty_names', label: 'Faculty', render: (x) => h('span.subtle', x.faculty_names) },
        ...stat,
      ],
      class: [{ key: 'label', label: 'Class', strong: true }, { key: 'faculty_count', label: 'Faculty', align: 'right' }, ...stat],
      section: [{ key: 'label', label: 'Section', strong: true }, ...stat],
      department: [{ key: 'label', label: 'Department', render: (x) => h('div', h('div.cell-strong', x.label), h('div.subtle', x.sub)) }, { key: 'faculty_count', label: 'Faculty', align: 'right' }, ...stat],
      question: [
        { key: 'position', label: '#', render: (x) => `Q${x.position}` },
        { key: 'text', label: 'Question', render: (x) => h('div', { style: { maxWidth: '520px' } }, x.text) },
        { key: 'average', label: 'Average', render: (x) => scoreBar(x.average) },
        { key: 'band', label: 'Rating', sort: (x) => x.average, render: (x) => bandChip(x.average) },
      ],
      semester: [{ key: 'semester', label: 'Semester', strong: true, render: (x) => x.label }, ...stat],
      academic_year: [{ key: 'label', label: 'Academic year', strong: true }, ...stat],
    };
    const chartRows = r.rows.slice(0, 15);
    const chart = hbar(chartRows.map((x) => ({
      label: group === 'question' ? `Q${x.position} ${x.short || ''}` : x.label,
      value: x.average,
      tip: group === 'question' ? x.text : x.label,
      extra: `${x.responses} responses`,
      onClick: group === 'faculty' ? () => (location.hash = `#/faculty-report/${x.faculty_id}`) : undefined,
    })), { labelWidth: group === 'class' ? 230 : 190 });
    clear(body, summary,
      h('div', { style: { padding: '16px 20px 4px' } }, chart, r.rows.length > 15 ? h('p.subtle', `Showing the top 15 of ${r.rows.length} in the chart. All rows are listed below.`) : null),
      dataTable({
        columns: colsByGroup[group],
        rows: r.rows,
        initialSort: group === 'question' || group === 'semester' || group === 'academic_year' ? undefined : { key: 'average', dir: 'desc' },
        onRowClick: group === 'faculty' ? (x) => (location.hash = `#/faculty-report/${x.faculty_id}`) : undefined,
      }));
  }
  await load();
}

/* ======================================================= faculty detail */
export async function facultyDetail(el, id) {
  const KEYS = ['cycle', 'year', 'semester', 'section', 'subject'];
  setTop('Faculty insights', { crumb: 'Reports', actions: [h('a.btn.btn-ghost.btn-sm', { href: '#/reports' }, icon('arrowLeft'), 'All faculty')] });
  const body = h('div.stack', { style: { '--gap': '20px' } });
  el.append(filterBar(KEYS, load, { extra: [h('button.btn.btn-primary.btn-sm', { onclick: () => download(`/api/admin/export${qs({ ...filterQuery(KEYS), faculty_id: id })}`, 'faculty-report.xlsx') }, icon('download'), 'Export Excel')] }), body);

  async function load() {
    loading(body, 400);
    const d = await api(`/api/admin/report/faculty/${id}${qs(filterQuery(KEYS))}`);
    const f = d.faculty;
    setTop(f.name, { crumb: 'Faculty insights', actions: [h('a.btn.btn-ghost.btn-sm', { href: '#/reports' }, icon('arrowLeft'), 'All faculty')] });
    const t = d.totals;
    const head = h('section.card.fac-head',
      avatar(f.name),
      h('div', h('h2', f.name), h('div.muted', `${f.designation || 'Faculty'} · ${f.department_code} · ${f.staff_id}`), h('div.row', { style: { marginTop: '8px', '--gap': '6px' } }, t.responses ? bandChip(t.average) : null, h('span.chip', `${fmtInt(t.responses)} responses`), f.status !== 'active' ? h('span.chip.chip-bad', 'Inactive') : null)),
      h('div.big-score', h('b', fmt(t.average)), h('small', ' / 10'), h('div.subtle', d.departmentAverage !== null ? `Department average ${fmt(d.departmentAverage)}` : '')));
    if (!t.responses) {
      clear(body, head, h('div.card.empty', icon('chart'), h('h3', 'No feedback for this faculty in the selected cycle'), h('p', 'Try “All cycles” in the filter above.')));
      return;
    }
    clear(body, head,
      t.responses < d.minResponses ? h('div.callout.warn', icon('alert'), h('span', `Only ${t.responses} response(s). Averages from small samples can be misleading.`)) : null,
      h('div.grid-3',
        card('Question-wise scores', null, [
          h('div.legend', { style: { marginBottom: '10px' } }, h('span', h('i'), f.name), h('span', h('i.ref'), 'Department average')),
          hbar(d.questions.map((q) => ({ label: `Q${q.position} ${q.short || ''}`, value: q.average, ref: q.department, tip: q.text })), { labelWidth: 190, refLabel: 'Department average' }),
        ]),
        h('div.stack', { style: { '--gap': '20px' } },
          card('Score distribution', 'Number of responses by overall average', columns(d.histogram.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count, tip: `Average between ${b.from} and ${b.to}` })), { height: 180, unit: ' responses' })),
          d.trend.length > 1 ? card('Across cycles', null, line(d.trend.map((r) => ({ label: `${r.academic_year} ${r.term}`, value: r.average, tip: r.name, extra: `${r.responses} responses` })), { height: 170, min: 0, max: 10 })) : null)),
      card('Subject & class breakdown', null, dataTable({
        columns: [
          { key: 'subject_name', label: 'Subject', render: (x) => h('div', h('div.cell-strong', x.subject_name), h('div.subtle.mono', x.subject_code)) },
          { key: 'label', label: 'Class' },
          { key: 'responses', label: 'Responses', align: 'right' },
          { key: 'average', label: 'Average', render: (x) => scoreBar(x.average) },
          { key: 'band', label: 'Rating', sort: (x) => x.average, render: (x) => h('div.row', { style: { '--gap': '6px' } }, bandChip(x.average), x.lowSample ? h('span.chip', 'Low sample') : null) },
        ],
        rows: d.breakdown,
      })),
      card(`Student comments (${d.comments.length})`, 'Shown exactly as written, without any identifying details', d.comments.length
        ? h('div.stack', d.comments.map((c) => h('div.comment', h('p', `“${c.comment}”`), h('div.subtle', `${c.subject_name} · Section ${c.section} · ${fmtDate(c.submitted_on)} · rated ${fmt(c.average, 1)}`))))
        : h('p.subtle', 'No written comments for this selection.')));
  }
  await load();
}

/* ============================================================ responses */
export async function responses(el) {
  setTop('Responses', { crumb: 'Feedback' });
  const KEYS = ['cycle', 'department', 'year', 'semester', 'section', 'faculty', 'subject'];
  let offset = 0;
  let commentsOnly = false;
  const limit = 50;
  const body = h('div');
  const toggle = h('label.switch', h('input', { type: 'checkbox', onchange: (e) => { commentsOnly = e.target.checked; offset = 0; load(); } }), h('span.track'), h('span', 'With comments only'));
  el.append(
    h('div.callout', icon('eyeOff'), h('span', 'Every response is anonymous. Records contain academic context and the submission date only — never a student name, register number or time of day.')),
    filterBar(KEYS, () => { offset = 0; load(); }, { extra: [exportButton(KEYS)] }),
    h('section.card', h('div.card-head', h('h3', 'Individual responses'), toggle), body));

  const questions = state.meta.questions.filter((q) => q.active);
  async function load() {
    loading(body, 300);
    const r = await api(`/api/admin/responses${qs({ ...filterQuery(KEYS), limit, offset, comments: commentsOnly ? 1 : '' })}`);
    const table = dataTable({
      columns: [
        { key: 'submitted_on', label: 'Date', render: (x) => h('span.subtle', fmtDate(x.submitted_on)) },
        { key: 'faculty_name', label: 'Faculty & subject', render: (x) => h('div', h('div.cell-strong', x.faculty_name), h('div.subtle', x.subject_name)) },
        { key: 'label', label: 'Class', render: (x) => h('span.subtle', x.label) },
        { key: 'ratings', label: questions.map((q) => `Q${q.position}`).join(' · '), sort: false, render: (x) => h('div.ratings-row', questions.map((q) => h('span', { title: q.text }, fmt(x.ratings[q.id], x.ratings[q.id] % 1 ? 1 : 0)))) },
        { key: 'average', label: 'Avg', align: 'right', render: (x) => h('b.num', fmt(x.average)) },
        { key: 'comment', label: 'Comment', render: (x) => (x.comment ? h('span', { style: { display: 'block', maxWidth: '280px', fontSize: '.86rem' } }, x.comment) : h('span.subtle', '—')) },
      ],
      rows: r.rows,
      empty: 'No responses match these filters.',
      emptyIcon: 'message',
    });
    const pages = Math.max(1, Math.ceil(r.total / limit));
    const page = Math.floor(offset / limit) + 1;
    clear(body, table, h('div.pager',
      h('span', r.total ? `${offset + 1}–${Math.min(offset + limit, r.total)} of ${fmtInt(r.total)}` : '0 responses'),
      h('div.row', { style: { '--gap': '6px' } },
        h('button.btn.btn-sm', { disabled: page <= 1, onclick: () => { offset -= limit; load(); } }, icon('arrowLeft'), 'Previous'),
        h('span.subtle', `Page ${page} of ${pages}`),
        h('button.btn.btn-sm', { disabled: page >= pages, onclick: () => { offset += limit; load(); } }, 'Next', icon('arrowRight')))));
  }
  await load();
}

/* =========================================================== completion */
export async function completion(el) {
  setTop('Completion tracking', { crumb: 'Feedback' });
  const KEYS = ['cycle', 'department', 'year', 'semester', 'section'];
  const body = h('div.stack', { style: { '--gap': '20px' } });
  el.append(
    h('div.callout', icon('shield'), h('span', 'Completion shows ', h('b', 'who'), ' has submitted, never ', h('b', 'what'), ' they answered. Completion records and anonymous ratings are stored separately and cannot be joined.')),
    filterBar(KEYS, load), body);

  async function load() {
    loading(body, 300);
    const d = await api(`/api/admin/completion${qs(filterQuery(KEYS))}`);
    if (!d.cycle) { clear(body, h('div.card.empty', icon('calendar'), h('h3', 'Pick a specific feedback cycle'), h('p', 'Completion is tracked per cycle.'))); return; }
    clear(body,
      h('div.kpis',
        kpi('target', 'Forms completed', [fmt(d.rate, 1), h('small', '%')], `${fmtInt(d.completed)} of ${fmtInt(d.expected)}`, d.rate),
        kpi('graduation', 'Students finished', [fmtInt(d.students_done), h('small', ` / ${fmtInt(d.students)}`)], 'Submitted every form', d.students ? (d.students_done / d.students) * 100 : 0),
        kpi('user', 'Not started', fmtInt(d.students - d.students_started), 'Students with no submissions yet')),
      card('Classes', `${d.cycle.name} · click a class for details`, dataTable({
        columns: [
          { key: 'label', label: 'Class', strong: true },
          { key: 'students', label: 'Students', align: 'right' },
          { key: 'forms', label: 'Forms each', align: 'right' },
          { key: 'students_done', label: 'Finished', align: 'right', render: (x) => `${x.students_done} / ${x.students}` },
          { key: 'rate', label: 'Completion', render: (x) => h('div.row', { style: { '--gap': '10px', flexWrap: 'nowrap' } }, h('div.progress', { style: { width: '140px' } }, h('i', { style: { width: `${x.rate}%` } })), h('b.num', `${fmt(x.rate, 1)}%`)) },
        ],
        rows: d.classes,
        initialSort: { key: 'rate', dir: 'asc' },
        onRowClick: (x) => classModal(x.id),
        empty: 'No classes match these filters.',
      })));
  }

  async function classModal(id) {
    const d = await api(`/api/admin/completion/class/${id}${qs(filterQuery(['cycle']))}`);
    let pendingOnly = true;
    const list = h('div');
    const paint = () => clear(list, dataTable({
      columns: [
        { key: 'register_no', label: 'Register no.', render: (x) => h('span.mono', x.register_no) },
        { key: 'name', label: 'Name' },
        { key: 'done', label: 'Submitted', align: 'right', render: (x) => h('span', { class: x.done >= d.total ? 'chip chip-good' : x.done ? 'chip chip-warn' : 'chip' }, `${x.done} / ${d.total}`) },
      ],
      rows: pendingOnly ? d.students.filter((s) => s.done < d.total) : d.students,
      empty: 'Everyone in this class has finished. 🎉',
    }));
    paint();
    modal({
      title: d.class.label,
      subtitle: `${d.students.length} students · ${d.total} forms each`,
      wide: true,
      body: h('div.stack', { style: { '--gap': '18px' } },
        h('div', h('div.label', { style: { marginBottom: '8px' } }, 'Per faculty-subject form'),
          h('div.stack', { style: { '--gap': '8px' } }, d.forms.map((f) => h('div.row', { style: { flexWrap: 'nowrap' } },
            h('div.grow', h('b', { style: { fontSize: '.9rem' } }, f.subject_name), h('div.subtle', f.faculty_name)),
            h('div.progress', { style: { width: '160px' } }, h('i', { style: { width: `${d.students.length ? (f.completed / d.students.length) * 100 : 0}%` } })),
            h('b.num', { style: { width: '64px', textAlign: 'right' } }, `${f.completed}/${d.students.length}`))))),
        h('div',
          h('div.spread', { style: { marginBottom: '8px' } }, h('div.label', 'Students'),
            h('label.switch', h('input', { type: 'checkbox', checked: true, onchange: (e) => { pendingOnly = e.target.checked; paint(); } }), h('span.track'), h('span.subtle', 'Pending only'))),
          list)),
    });
  }
  await load();
}

