// Faculty portal: each faculty member sees only aggregated, anonymous feedback about themselves.
import { h, clear, icon, api, qs, toast, themeToggle, fmt, fmtInt, fmtDate, bandChip, avatar, scoreBar, download, LOGO, setupPrint, printButton } from './core.js';
import { hbar, columns, line } from './charts.js';
import { dataTable } from './admin/table.js';

const app = document.getElementById('app');
let me = null;
const filters = (() => { try { return JSON.parse(sessionStorage.getItem('afs-ffilters')) || {}; } catch { return {}; } })();
const saveFilters = () => { try { sessionStorage.setItem('afs-ffilters', JSON.stringify(filters)); } catch { /* ignore */ } };

setupPrint({ getTitle: () => `Feedback report — ${me?.name || ''}`, getSubtitle: () => me?.institution, container: () => document.getElementById('fp-main') });

/* ----------------------------------------------------------------- login */
function viewLogin(message) {
  const err = h('div.callout.bad.hidden', { role: 'alert' });
  const sid = h('input.input#sid', { autocomplete: 'username', required: true, style: { textTransform: 'uppercase' }, placeholder: 'e.g. FAC101' });
  const pw = h('input.input#pw', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Sign in');
  clear(app, h('div.login',
    h('section.login-art',
      h('div.brand-line', LOGO(), 'Faculty Feedback · Faculty portal'),
      h('div',
        h('h1', 'See what your students value — and where to grow.'),
        h('p', 'Your personal, private view of anonymous student feedback: question-wise scores, class breakdowns, trends across semesters and written comments.')),
      h('div.feat',
        h('span', icon('eyeOff'), 'Students are fully anonymous'),
        h('span', icon('shield'), 'Small groups are hidden to protect them'),
        h('span', icon('printer'), 'Print or export your own report'))),
    h('section.login-form',
      h('form.stack', {
        style: { '--gap': '16px' },
        onsubmit: async (e) => {
          e.preventDefault();
          err.classList.add('hidden');
          btn.disabled = true;
          clear(btn, h('span.spinner'), 'Signing in…');
          try {
            await api('/api/faculty/login', { method: 'POST', body: { staff_id: sid.value.trim(), password: pw.value } });
            await boot();
          } catch (ex) {
            clear(err, icon('alert'), h('span', ex.message));
            err.classList.remove('hidden');
            btn.disabled = false;
            clear(btn, 'Sign in');
          }
        },
      },
      h('div', h('h2', 'Faculty sign in'), h('p.muted', { style: { marginTop: '6px' } }, 'Use your Staff ID. First time here? Your initial password is also your Staff ID.')),
      message ? h('div.callout', icon('info'), h('span', message)) : null,
      err,
      h('div.field', h('label', { for: 'sid' }, 'Staff ID'), sid),
      h('div.field', h('label', { for: 'pw' }, 'Password'), pw),
      btn,
      h('div.row.subtle', { style: { justifyContent: 'space-between' } }, h('a', { href: '/' }, '← Student portal'), h('a', { href: '/admin' }, 'Admin sign in →'))))));
  sid.focus();
}

/* --------------------------------------------------------- set password */
function viewSetPassword() {
  const cur = h('input.input#cur', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input.input#nw', { type: 'password', autocomplete: 'new-password' });
  const nw2 = h('input.input#nw2', { type: 'password', autocomplete: 'new-password' });
  const err = h('div.callout.bad.hidden', { role: 'alert' });
  clear(app, shell(h('section.card.card-pad', { style: { maxWidth: '460px', margin: '40px auto' } },
    h('form.stack', {
      style: { '--gap': '16px' },
      onsubmit: async (e) => {
        e.preventDefault();
        err.classList.add('hidden');
        if (nw.value !== nw2.value) { clear(err, icon('alert'), h('span', 'The new passwords do not match.')); err.classList.remove('hidden'); return; }
        try {
          await api('/api/faculty/password', { method: 'POST', body: { current: cur.value, next: nw.value } });
          toast('Password set. Welcome!');
          boot();
        } catch (ex) { clear(err, icon('alert'), h('span', ex.message)); err.classList.remove('hidden'); }
      },
    },
    h('div', h('h2', 'Set your password'), h('p.muted', { style: { marginTop: '6px' } }, 'For your privacy, choose a personal password before viewing your feedback.')),
    err,
    h('div.field', h('label', { for: 'cur' }, 'Current password'), cur, h('span.hint', 'On first sign-in this is your Staff ID.')),
    h('div.field', h('label', { for: 'nw' }, 'New password'), nw, h('span.hint', 'At least 8 characters, different from your Staff ID.')),
    h('div.field', h('label', { for: 'nw2' }, 'Confirm new password'), nw2),
    h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit' }, 'Save password')))));
  cur.focus();
}

function shell(...content) {
  return h('div', { style: { display: 'contents' } },
    h('header.topbar',
      h('a.brand', { href: '/faculty' }, LOGO(), h('div.grow', h('b', me.institution), h('small', 'Faculty portal'))),
      h('div.row', { style: { '--gap': '6px' } },
        h('span.chip.chip-primary.hide-sm', icon('user'), me.staff_id),
        h('button.btn.btn-ghost.btn-sm', { onclick: logout }, icon('logout'), 'Sign out'),
        themeToggle())),
    h('main#fp-main', ...content));
}

async function logout() {
  await api('/api/faculty/logout', { method: 'POST' });
  me = null;
  viewLogin('You have been signed out.');
}

/* ---------------------------------------------------------------- report */
const card = (title, sub, body) => h('section.card', h('div.card-head', h('div', h('h3', title), sub ? h('div.subtle', sub) : null)), h('div.card-body', body));
const kpi = (ic, label, value, foot) => h('div.card.kpi', h('div.k-label', h('span.ico', icon(ic)), label), h('div.k-value', value), foot ? h('div.k-foot', foot) : null);

async function viewReport() {
  const meta = await api('/api/faculty/meta');
  const body = h('div.stack', { style: { '--gap': '20px' } });
  const opt = (v, l, cur) => h('option', { value: v, selected: String(cur ?? '') === String(v) }, l);
  const sel = (name, label, options) => h('div.field', h('label', { for: `ff-${name}` }, label),
    h('select.select', { id: `ff-${name}`, onchange: (e) => { filters[name] = e.target.value; saveFilters(); load(); } }, options));
  const filterBar = h('div.card.filters', { role: 'search' },
    sel('cycle_id', 'Feedback cycle', [opt('', 'Current cycle', filters.cycle_id), opt('all', 'All cycles', filters.cycle_id), ...meta.cycles.map((c) => opt(c.id, c.name, filters.cycle_id))]),
    sel('subject_id', 'Subject', [opt('', 'All subjects', filters.subject_id), ...meta.subjects.map((s) => opt(s.id, `${s.name} (${s.code})`, filters.subject_id))]),
    sel('section', 'Section', [opt('', 'All sections', filters.section), ...meta.sections.map((s) => opt(s, `Section ${s}`, filters.section))]),
    h('div.actions',
      h('button.btn.btn-primary.btn-sm', { onclick: exportXlsx }, icon('download'), 'Export Excel'),
      printButton()));

  clear(app, shell(
    h('div.fac-portal',
      h('section.card.fac-head', avatar(me.name), h('div', h('h2', me.name), h('div.muted', `${me.designation || 'Faculty'} · ${me.department_code} · ${me.staff_id}`)), h('div.big-score#fp-score')),
      h('div.callout.no-print', icon('eyeOff'), h('span', `You see combined results only — never who said what. Groups with fewer than ${meta.minResponses} responses are hidden to protect student anonymity.`)),
      filterBar,
      body)));

  async function exportXlsx() {
    try { await download(`/api/faculty/export${qs(cleanFilters())}`, 'my-feedback.xlsx'); toast('Report downloaded.'); } catch (ex) { toast(ex.message, 'bad'); }
  }

  async function load() {
    clear(body, h('div.skeleton', { style: { height: '360px' } }));
    const d = await api(`/api/faculty/report${qs(cleanFilters())}`);
    const t = d.totals;
    const score = document.getElementById('fp-score');
    clear(score, t.average !== null ? [h('b', fmt(t.average)), h('small', ' / 10'), h('div.subtle', d.departmentAverage !== null ? `Department average ${fmt(d.departmentAverage)}` : '')] : '');

    if (!t.responses) {
      clear(body, h('div.card.empty', icon('message'), h('h3', 'No feedback yet for this selection'), h('p', 'Once students submit feedback it will appear here. Try “All cycles”.')));
      return;
    }
    if (d.suppressed) {
      clear(body, h('div.card.empty', icon('shield'), h('h3', 'Not enough responses yet'), h('p', `There ${t.responses === 1 ? 'is 1 response' : `are ${t.responses} responses`} for this selection. Results appear once at least ${d.minResponses} students have responded, so no one can be identified.`)));
      return;
    }
    const diff = d.departmentAverage !== null ? t.average - d.departmentAverage : null;
    const best = [...d.questions].filter((q) => q.average !== null).sort((a, b) => b.average - a.average);
    clear(body,
      h('div.kpis',
        kpi('sparkles', 'Your average', [fmt(t.average), h('small', ' / 10')], bandChip(t.average)),
        kpi('message', 'Responses', fmtInt(t.responses), `${d.comments.length} written comment${d.comments.length === 1 ? '' : 's'}`),
        diff !== null ? kpi('trendUp', 'vs. department', [(diff >= 0 ? '+' : '') + fmt(diff), h('small', ' pts')], `Department average ${fmt(d.departmentAverage)}`) : null,
        best.length ? kpi('target', 'Strongest area', h('span', { style: { fontSize: '1.1rem' } }, best[0].short || `Q${best[0].position}`), `${fmt(best[0].average)} · weakest: ${best.at(-1).short || `Q${best.at(-1).position}`} (${fmt(best.at(-1).average)})`) : null),
      h('div.grid-3',
        card('Question-wise scores', 'Your average for each question, with the department average for comparison', [
          h('div.legend', { style: { marginBottom: '10px' } }, h('span', h('i'), 'You'), h('span', h('i.ref'), 'Department average')),
          hbar(d.questions.map((q) => ({ label: `Q${q.position} ${q.short || ''}`, value: q.average, ref: q.department, tip: q.text })), { labelWidth: 190, refLabel: 'Department average' }),
        ]),
        h('div.stack', { style: { '--gap': '20px' } },
          card('Score distribution', 'Responses by overall rating', columns(d.histogram.map((b) => ({ label: `${b.from}–${b.to}`, value: b.count, tip: `Rated between ${b.from} and ${b.to}` })), { height: 180, unit: ' responses' })),
          d.trend.length > 1 ? card('Across cycles', null, line(d.trend.map((r) => ({ label: `${r.academic_year} ${r.term}`, value: r.average, tip: r.name, extra: `${r.responses} responses` })), { height: 170 })) : null)),
      card('By subject and class', null, dataTable({
        columns: [
          { key: 'subject_name', label: 'Subject', render: (x) => h('div', h('div.cell-strong', x.subject_name), h('div.subtle.mono', x.subject_code)) },
          { key: 'label', label: 'Class' },
          { key: 'responses', label: 'Responses', align: 'right' },
          { key: 'average', label: 'Average', render: (x) => (x.suppressed ? h('span.chip', { title: 'Hidden to protect anonymity' }, icon('lock'), ' Too few responses') : scoreBar(x.average)) },
          { key: 'band', label: 'Rating', sort: (x) => x.average, render: (x) => (x.suppressed ? '—' : bandChip(x.average)) },
        ],
        rows: d.breakdown,
      })),
      card(`What students wrote (${d.comments.length})`, 'Anonymous comments, shown exactly as written', d.comments.length
        ? h('div.stack', d.comments.map((c) => h('div.comment', h('p', `“${c.comment}”`), h('div.subtle', `${c.subject_name} · ${fmtDate(c.submitted_on)}`))))
        : h('p.subtle', 'No written comments for this selection.')));
  }
  await load();
}

const cleanFilters = () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v));

async function boot() {
  try {
    me = await api('/api/faculty/me');
  } catch {
    return viewLogin();
  }
  document.title = `${me.name} · Faculty Portal`;
  if (me.mustChange) return viewSetPassword();
  try {
    await viewReport();
  } catch (ex) {
    if (ex.status === 401) return viewLogin('Your session has expired. Please sign in again.');
    if (ex.status === 403) return viewSetPassword();
    toast(ex.message, 'bad');
  }
}
boot();
