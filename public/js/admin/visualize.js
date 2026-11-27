// Visualize: compare any set of entities (classes, staff, years, …) side by side,
// with drill-down. Views: heatmap (entity × question), cards, ranking, rating mix.
import { h, clear, icon, api, qs, fmt, fmtInt, bandChip, toast, download, printButton, downloadCsv, roman } from '../core.js';
import { hbar, miniBars } from '../charts.js';
import { state, setTop, filterBar, filterQuery, saveFilters, loading } from './shared.js';

const DIMENSIONS = [
  ['class', 'Each class', 'layers'],
  ['faculty', 'Each staff', 'users'],
  ['year', 'Each year', 'graduation'],
  ['semester', 'Each semester', 'calendar'],
  ['section', 'Each section', 'grid'],
  ['subject', 'Each subject', 'book'],
  ['department', 'Each department', 'building'],
  ['academic_year', 'Academic years', 'trendUp'],
];
const VIEWS = [
  ['heatmap', 'Heatmap', 'grid'],
  ['cards', 'Cards', 'layers'],
  ['ranking', 'Ranking', 'chart'],
  ['mix', 'Rating mix', 'list'],
];
const KEYS = ['cycle', 'department', 'year', 'semester', 'section', 'faculty', 'subject'];

// Sequential single-hue ramp (light → dark) for magnitude; value text is always printed in the cell.
const RAMP = ['#eef2ff', '#dbe1fe', '#c3cbfc', '#a5b0f8', '#8690f1', '#6a6fe6', '#5550d8', '#4338ca', '#362da6', '#2a2384'];
const DOMAIN = [5, 10];
function cellColor(v) {
  if (v === null || v === undefined) return null;
  const t = Math.max(0, Math.min(1, (v - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])));
  const i = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
  return { bg: RAMP[i], fg: i >= 5 ? '#ffffff' : '#1a1a33' };
}

export async function visualize(el) {
  setTop('Visualize', { crumb: 'Feedback' });
  let dim = sessionStorage.getItem('afs-viz-dim') || 'class';
  let view = sessionStorage.getItem('afs-viz-view') || 'heatmap';
  let data = null;

  const crumbs = h('div.row.drill', { style: { '--gap': '6px' } });
  const dimBar = h('div.segmented', { role: 'group', 'aria-label': 'Compare' });
  const viewBar = h('div.segmented', { role: 'group', 'aria-label': 'View' });
  const body = h('div');
  const summary = h('div.subtle');
  let filters = makeFilters();

  function makeFilters() {
    return filterBar(KEYS, load, {
      extra: [
        h('button.btn.btn-sm', { onclick: exportCsv, title: 'Download this comparison as CSV' }, icon('download'), 'CSV'),
        h('button.btn.btn-primary.btn-sm', { onclick: exportXlsx }, icon('download'), 'Excel'),
        printButton(),
      ],
    });
  }

  const paintBars = () => {
    clear(dimBar, DIMENSIONS.map(([k, label, ic]) => h('button', { 'aria-pressed': String(k === dim), onclick: () => { dim = k; sessionStorage.setItem('afs-viz-dim', k); paintBars(); load(); } }, icon(ic), ' ', label)));
    clear(viewBar, VIEWS.map(([k, label, ic]) => h('button', { 'aria-pressed': String(k === view), onclick: () => { view = k; sessionStorage.setItem('afs-viz-view', k); paintBars(); render(); } }, icon(ic), ' ', label)));
  };
  paintBars();

  el.append(
    filters,
    h('section.card',
      h('div.card-head.view-controls', h('div.stack', { style: { '--gap': '10px' } },
        h('div.row', { style: { '--gap': '10px' } }, h('span.label', 'Compare'), dimBar),
        h('div.row', { style: { '--gap': '10px' } }, h('span.label', 'Show as'), viewBar))),
      h('div.card-body', h('div.spread', { style: { marginBottom: '14px' } }, crumbs, summary), body)));

  function paintCrumbs() {
    const f = state.filters;
    const m = state.meta;
    const parts = [];
    const add = (key, label) => parts.push(h('span.chip.chip-primary', label, h('button.btn-x', { 'aria-label': `Remove ${label}`, onclick: () => { f[key] = ''; saveFilters(); rebuild(); } }, '×')));
    if (f.department_id) add('department_id', m.departments.find((d) => d.id === Number(f.department_id))?.code || 'Department');
    if (f.year) add('year', `${roman(Number(f.year))} Year`);
    if (f.semester) add('semester', `Sem ${roman(Number(f.semester))}`);
    if (f.section) add('section', `Section ${f.section}`);
    if (f.faculty_id) add('faculty_id', m.faculty.find((x) => x.id === Number(f.faculty_id))?.name || 'Faculty');
    if (f.subject_id) add('subject_id', m.subjects.find((x) => x.id === Number(f.subject_id))?.name || 'Subject');
    clear(crumbs, h('span.subtle', parts.length ? 'Drilled into:' : 'Showing everything in scope. Click any row or card to drill in.'), parts);
  }

  function rebuild() {
    const fresh = makeFilters();
    filters.replaceWith(fresh);
    filters = fresh;
    load();
  }

  /** Clicking an entity narrows the filters and moves to the next useful comparison. */
  function drill(r) {
    const f = state.filters;
    if (dim === 'faculty') { location.hash = `#/faculty-report/${r.faculty_id}`; return; }
    if (dim === 'class') {
      const c = state.meta.classes.find((x) => x.department_code === r.department_code && x.year === r.year && x.semester === r.semester && x.section === r.section);
      Object.assign(f, { department_id: c ? c.department_id : f.department_id, year: r.year, semester: r.semester, section: r.section });
      dim = 'faculty';
    } else if (dim === 'year') { f.year = r.year; f.semester = ''; f.section = ''; dim = 'class'; }
    else if (dim === 'semester') { f.semester = r.semester; dim = 'class'; }
    else if (dim === 'section') { f.section = r.label.replace('Section ', ''); dim = 'faculty'; }
    else if (dim === 'subject') { f.subject_id = r.subject_id; dim = 'faculty'; }
    else if (dim === 'department') { f.department_id = r.department_id; f.year = ''; f.semester = ''; f.section = ''; dim = 'class'; }
    else return;
    if (state.me.role !== 'super_admin') f.department_id = '';
    sessionStorage.setItem('afs-viz-dim', dim);
    saveFilters();
    paintBars();
    rebuild();
  }

  async function load() {
    paintCrumbs();
    loading(body, 320);
    data = await api(`/api/admin/matrix${qs({ ...filterQuery(KEYS), group: dim })}`);
    const o = data.overall;
    const NOUN = { class: ['class', 'classes'], faculty: ['staff member', 'staff'], year: ['year', 'years'], semester: ['semester', 'semesters'], section: ['section', 'sections'], subject: ['subject', 'subjects'], department: ['department', 'departments'], academic_year: ['academic year', 'academic years'] }[dim];
    clear(summary, `${fmtInt(data.rows.length)} ${NOUN[data.rows.length === 1 ? 0 : 1]} · ${fmtInt(o.responses)} responses · overall ${fmt(o.average)}`);
    render();
  }

  const lowChip = (r) => (r.lowSample ? h('span.chip', { title: `Fewer than ${data.minResponses} responses` }, 'Low sample') : null);
  const subOf = (r) => (dim === 'faculty' ? `${r.department_code} · ${r.designation || ''}` : dim === 'subject' ? `${r.sub} · ${r.faculty_names || ''}` : dim === 'department' ? r.sub : '');

  function render() {
    if (!data) return;
    if (!data.rows.length) {
      clear(body, h('div.empty', icon('chart'), h('h3', 'No feedback for this selection'), h('p', 'Widen the filters or pick “All cycles”.')));
      return;
    }
    const rows = data.rows;
    const qs10 = data.questions;
    const clickable = dim !== 'academic_year';

    if (view === 'heatmap') {
      clear(body,
        h('div.legend.heat-legend', h('span', 'Lower'), RAMP.map((c) => h('i', { style: { background: c } })), h('span', 'Higher'), h('span.subtle', `· colour scale ${DOMAIN[0]}–${DOMAIN[1]}, values ≤ ${DOMAIN[0]} use the lightest shade`)),
        h('div.table-wrap.heat-wrap', h('table.table.heatmap',
          h('thead', h('tr', h('th.sticky-col', DIMENSIONS.find((d) => d[0] === dim)[1].replace('Each ', '')), h('th.right', 'Resp.'),
            qs10.map((q) => h('th.right', { title: q.text }, `Q${q.position}`)), h('th.right', 'Overall'))),
          h('tbody', rows.map((r) => h(`tr${clickable ? '.clickable' : ''}`, { onclick: clickable ? () => drill(r) : null, tabIndex: clickable ? 0 : null, onkeydown: (e) => clickable && e.key === 'Enter' && drill(r) },
            h('td.sticky-col', h('div.cell-strong', r.label), subOf(r) ? h('div.subtle', subOf(r)) : null, lowChip(r)),
            h('td.right.num', fmtInt(r.responses)),
            qs10.map((q) => heatCell(r.questions[q.id], `${r.label} · Q${q.position} ${q.short || ''}`)),
            heatCell(r.average, `${r.label} · overall`, true)))))),
        h('p.subtle', { style: { marginTop: '10px' } }, qs10.map((q) => `Q${q.position} ${q.short || q.text}`).join(' · ')));
    } else if (view === 'cards') {
      clear(body, h('div.viz-cards', rows.map((r) => h(`button.viz-card${clickable ? '' : '.static'}`, { onclick: clickable ? () => drill(r) : null, disabled: !clickable },
        h('div.spread', { style: { alignItems: 'flex-start' } }, h('div', { style: { minWidth: 0 } }, h('b', r.label), subOf(r) ? h('div.subtle', subOf(r)) : null),
          h('div.vc-score', h('b', fmt(r.average)), h('small', '/10'))),
        h('div.row', { style: { '--gap': '6px' } }, bandChip(r.average), h('span.chip', `${fmtInt(r.responses)} resp.`), lowChip(r)),
        miniBars(qs10.map((q) => r.questions[q.id] ?? 0), { height: 52 }),
        h('div.vc-foot', weakest(r, qs10))))));
    } else if (view === 'ranking') {
      clear(body, hbar([...rows].sort((a, b) => b.average - a.average).map((r) => ({
        label: r.label, value: r.average, tip: r.label, extra: `${r.responses} responses`, onClick: clickable ? () => drill(r) : undefined,
      })), { labelWidth: dim === 'class' ? 250 : 200, rowH: 28 }));
    } else {
      clear(body,
        h('div.legend', { style: { marginBottom: '12px' } },
          h('span', h('i', { style: { background: 'var(--good-mark)' } }), 'Excellent (≥ 8)'),
          h('span', h('i', { style: { background: 'var(--warn-mark)' } }), 'Good (6 – 8)'),
          h('span', h('i', { style: { background: 'var(--bad-mark)' } }), 'Needs focus (< 6)')),
        h('div.mix', rows.map((r) => {
          const tot = r.responses || 1;
          const seg = (n, cls, label) => (n ? h(`i.${cls}`, { style: { width: `${(n / tot) * 100}%` }, title: `${label}: ${n} (${Math.round((n / tot) * 100)}%)` }, (n / tot) >= 0.1 ? `${Math.round((n / tot) * 100)}%` : '') : null);
          return h(`div.mix-row${clickable ? '.clickable' : ''}`, { onclick: clickable ? () => drill(r) : null },
            h('div.mix-label', h('b', r.label), h('span.subtle', `${fmtInt(r.responses)} responses · avg ${fmt(r.average)}`)),
            h('div.mix-bar', seg(r.band_high, 'hi', 'Excellent'), seg(r.band_mid, 'mid', 'Good'), seg(r.band_low, 'lo', 'Needs focus')));
        })));
    }
  }

  function heatCell(v, title, strong) {
    const c = cellColor(v);
    return h(`td.right.heat${strong ? '.heat-strong' : ''}`, { title: `${title}: ${fmt(v)}`, style: c ? { background: c.bg, color: c.fg } : {} }, fmt(v, 1));
  }

  function weakest(r, qs10) {
    const scored = qs10.map((q) => [q, r.questions[q.id]]).filter(([, v]) => v !== undefined && v !== null);
    if (!scored.length) return '';
    const [q, v] = scored.sort((a, b) => a[1] - b[1])[0];
    return [h('span.subtle', 'Lowest: '), `Q${q.position} ${q.short || ''} (${fmt(v, 1)})`];
  }

  function exportCsv() {
    if (!data?.rows.length) return toast('Nothing to export yet.', 'bad');
    downloadCsv(`visualize-${dim}-${new Date().toISOString().slice(0, 10)}.csv`,
      [DIMENSIONS.find((d) => d[0] === dim)[1].replace('Each ', ''), 'Responses', ...data.questions.map((q) => `Q${q.position} ${q.short || ''}`.trim()), 'Overall', 'Excellent (>=8)', 'Good (6-8)', 'Needs focus (<6)'],
      data.rows.map((r) => [r.label, r.responses, ...data.questions.map((q) => r.questions[q.id] ?? ''), r.average, r.band_high, r.band_mid, r.band_low]));
  }
  async function exportXlsx() {
    try { await download(`/api/admin/export${qs(filterQuery(KEYS))}`, 'feedback-report.xlsx'); toast('Excel report downloaded.'); } catch (ex) { toast(ex.message, 'bad'); }
  }

  await load();
}
