// Official class report: the institution's printed "Student's Feedback on Course Delivery"
// format from the previous system, as an on-screen preview plus View / Download PDF.
import { h, clear, icon, api, qs, fmt, toast, download } from '../core.js';
import { columns } from '../charts.js';
import { state, setTop, filterBar, filterQuery, loading } from './shared.js';

const KEYS = ['cycle', 'department', 'year', 'semester', 'section'];

export async function classReport(el) {
  setTop('Class report', { crumb: 'Feedback' });
  const body = h('div');
  const pdfUrl = (dl) => `/api/admin/class-report${qs({ ...filterQuery(KEYS), format: 'pdf', download: dl ? 1 : '' })}`;
  el.append(
    h('div.callout', icon('file'), h('span', 'The official class-wise report in the college’s printed format: staff × Q1–Q10 with Total out of 100, a bar chart, references, the questions and signature lines. Choose a department and semester, then view or download the PDF.')),
    filterBar(KEYS, load, {
      extra: [
        h('a.btn.btn-sm', { href: '#', onclick: (e) => { e.preventDefault(); if (ready()) window.open(pdfUrl(false), '_blank', 'noopener'); } }, icon('eye'), 'View PDF'),
        h('button.btn.btn-primary.btn-sm', { onclick: async () => { if (!ready()) return; try { await download(pdfUrl(true), 'class-report.pdf'); toast('PDF downloaded.'); } catch (ex) { toast(ex.message, 'bad'); } } }, icon('download'), 'Download PDF'),
      ],
    }),
    body);

  function ready() {
    const f = state.filters;
    if ((state.me.role === 'super_admin' && !f.department_id) || !f.semester) {
      toast('Choose a department and a semester first.', 'bad');
      return false;
    }
    return true;
  }

  async function load() {
    const f = state.filters;
    if ((state.me.role === 'super_admin' && !f.department_id) || !f.semester) {
      clear(body, h('div.card.empty', icon('filter'), h('h3', 'Choose a department and semester'), h('p', 'The class report is produced for one department and semester (optionally one section).')));
      return;
    }
    loading(body, 400);
    const d = await api(`/api/admin/class-report${qs(filterQuery(KEYS))}`);
    clear(body, h('section.card.official',
      h('header.off-head',
        h('h2', d.institution.toUpperCase()),
        d.subtitle ? h('p', d.subtitle) : null,
        h('p.off-title', d.title),
        h('p.off-info', `Academic year: ${d.academicYear || '—'}   ·   Branch: ${d.branch}   ·   Semester: ${d.semester}   ·   Year: ${d.year}   ·   Section: ${d.section}`),
        h('p.subtle', `${d.cycle} · ${d.responses} anonymous responses`)),
      d.rows.length
        ? [
          h('div.table-wrap', h('table.table.off-table',
            h('thead', h('tr', h('th', 'Ref'), h('th', 'Staff name'), h('th', 'Subject'), d.questions.map((q) => h('th.right', { title: q.text }, `Q${q.position}`)), h('th.right', 'Total'))),
            h('tbody', d.rows.map((r) => h('tr', h('td', h('span.chip', r.reference)), h('td.cell-strong', r.staff_name), h('td', r.subject), r.scores.map((v) => h('td.right.num', v === null ? '—' : fmt(v, 1))), h('td.right.num.cell-strong', fmt(r.total, 1))))))),
          h('div', { style: { padding: '8px 20px 0' } }, h('div.label', { style: { marginBottom: '6px' } }, 'Total score out of 100'),
            columns(d.rows.map((r) => ({ label: r.reference, value: r.total, tip: `${r.staff_name} — ${r.subject}`, fmt: (v) => fmt(v, 1) })), { height: 220, max: 100, showEvery: 1 })),
          h('div.off-refs',
            h('div', h('b', 'References'), h('ul', d.rows.map((r) => h('li', `${r.reference}: ${r.staff_name} – ${r.subject} (${r.responses} responses)`)))),
            h('div', h('b', 'Questions'), h('ol', d.questions.map((q) => h('li', q.text))))),
          h('div.off-sign', d.signatures.map((s) => h('span', s))),
        ]
        : h('div.empty', icon('chart'), h('h3', 'No feedback for this class yet'), h('p', 'Try another cycle or semester.')),
      d.footer ? h('footer.off-foot', d.footer) : null));
  }
  await load();
}
