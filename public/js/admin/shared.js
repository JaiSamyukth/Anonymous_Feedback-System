import { h, clear, api, roman, icon } from '../core.js';

export const state = {
  me: null,
  meta: null,
  filters: loadFilters(),
};

function loadFilters() {
  try { return JSON.parse(sessionStorage.getItem('afs-filters')) || {}; } catch { return {}; }
}
export function saveFilters() {
  try { sessionStorage.setItem('afs-filters', JSON.stringify(state.filters)); } catch { /* ignore */ }
}

export async function loadMeta() {
  state.meta = await api('/api/admin/meta');
  return state.meta;
}

export const isSuper = () => state.me?.role === 'super_admin';

/** Page chrome: set the top bar title + actions. */
let topTitle, topActions, topCrumb;
export function bindTop(titleEl, crumbEl, actionsEl) { topTitle = titleEl; topCrumb = crumbEl; topActions = actionsEl; }
export function setTop(title, { crumb = '', actions = [] } = {}) {
  topTitle.textContent = title;
  topCrumb.textContent = crumb;
  clear(topActions, actions);
  document.title = `${title} · Feedback Admin`;
}

const opt = (value, label, selected) => h('option', { value, selected: String(selected ?? '') === String(value) }, label);

/**
 * Reusable filter bar. keys: subset of cycle, department, year, semester, section, faculty, subject.
 * Uses (and updates) state.filters so selections persist across pages.
 */
export function filterBar(keys, onChange, { extra = [] } = {}) {
  const f = state.filters;
  const m = state.meta;
  const fields = {};
  const wrap = h('div.card.filters', { role: 'search', 'aria-label': 'Filters' });

  const build = () => {
    const dept = isSuper() ? f.department_id : state.me.department_id;
    const deptClasses = m.classes.filter((c) => !dept || c.department_id === Number(dept));
    const years = [...new Set(deptClasses.map((c) => c.year))].sort();
    const sems = [...new Set(deptClasses.filter((c) => !f.year || c.year === Number(f.year)).map((c) => c.semester))].sort((a, b) => a - b);
    const secs = [...new Set(deptClasses.filter((c) => (!f.year || c.year === Number(f.year)) && (!f.semester || c.semester === Number(f.semester))).map((c) => c.section))].sort();
    const defs = {
      cycle: ['cycle_id', 'Feedback cycle', [opt('', 'Current cycle', f.cycle_id), opt('all', 'All cycles', f.cycle_id), ...m.cycles.map((c) => opt(c.id, `${c.name}${c.status === 'open' ? ' (open)' : ''}`, f.cycle_id))]],
      department: isSuper() ? ['department_id', 'Department', [opt('', 'All departments', f.department_id), ...m.departments.map((d) => opt(d.id, d.code, f.department_id))]] : null,
      year: ['year', 'Year', [opt('', 'All years', f.year), ...years.map((y) => opt(y, `${roman(y)} Year`, f.year))]],
      semester: ['semester', 'Semester', [opt('', 'All semesters', f.semester), ...sems.map((s) => opt(s, `Semester ${roman(s)}`, f.semester))]],
      section: ['section', 'Section', [opt('', 'All sections', f.section), ...secs.map((s) => opt(s, `Section ${s}`, f.section))]],
      faculty: ['faculty_id', 'Faculty', [opt('', 'All faculty', f.faculty_id), ...m.faculty.filter((x) => !dept || x.department_id === Number(dept)).map((x) => opt(x.id, x.name, f.faculty_id))]],
      subject: ['subject_id', 'Subject', [opt('', 'All subjects', f.subject_id), ...m.subjects.filter((x) => !dept || x.department_id === Number(dept)).map((x) => opt(x.id, x.name, f.subject_id))]],
    };
    const nodes = [];
    for (const k of keys) {
      const d = defs[k];
      if (!d) continue;
      const [name, label, options] = d;
      const sel = h('select.select', { id: `f-${name}`, onchange: (e) => {
        f[name] = e.target.value;
        if (name === 'department_id') { f.year = ''; f.semester = ''; f.section = ''; f.faculty_id = ''; f.subject_id = ''; }
        if (name === 'year') { f.semester = ''; f.section = ''; }
        if (name === 'semester') f.section = '';
        saveFilters();
        build();
        onChange();
      } }, options);
      fields[name] = sel;
      nodes.push(h('div.field', h('label', { for: `f-${name}` }, label), sel));
    }
    const active = keys.some((k) => defs[k] && f[defs[k][0]]);
    clear(wrap, nodes, h('div.actions',
      active ? h('button.btn.btn-ghost.btn-sm', { onclick: () => { for (const k of keys) if (defs[k]) f[defs[k][0]] = ''; saveFilters(); build(); onChange(); } }, 'Reset') : null,
      extra));
  };
  build();
  return wrap;
}

/** Query object for the current filters (only the given keys). */
export function filterQuery(keys = ['cycle', 'department', 'year', 'semester', 'section', 'faculty', 'subject']) {
  const map = { cycle: 'cycle_id', department: 'department_id', year: 'year', semester: 'semester', section: 'section', faculty: 'faculty_id', subject: 'subject_id' };
  const q = {};
  for (const k of keys) if (state.filters[map[k]]) q[map[k]] = state.filters[map[k]];
  return q;
}

export function loading(el, height = 200) {
  clear(el, h('div.skeleton', { style: { height: `${height}px` } }));
}

export function errorBox(el, ex, retry) {
  clear(el, h('div.card.empty', h('h3', 'Could not load this view'), h('p', ex.message), retry && h('button.btn.btn-primary', { onclick: retry }, 'Try again')));
}

export function defaultPasswordBanner() {
  if (!state.me?.defaultPassword) return null;
  return h('div.banner', icon('alert'), h('span.grow', 'You are using the default demo password. Change it before sharing this portal.'),
    h('button.btn.btn-sm', { onclick: () => window.dispatchEvent(new Event('afs:account')) }, 'Change password'));
}
