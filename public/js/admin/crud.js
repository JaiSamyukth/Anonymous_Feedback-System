import { h, clear, icon, api, qs, toast, modal, confirmDialog, debounce, fmtInt, downloadCsv, printButton } from '../core.js';
import { state, setTop, loadMeta, isSuper } from './shared.js';
import { dataTable } from './table.js';

/**
 * Generic list + create/edit/delete page.
 * cfg: {
 *   title, crumb, endpoint, noun, columns, fields: [{ name, label, type, options?(values), required, hint, dependsOn, default }],
 *   toolbar?: [{ name, label, options() }], search, readOnly?(), canDelete?, bulk?(selected, reload), intro?
 * }
 */
export function crudPage(el, cfg) {
  const query = { q: '' };
  const canWrite = cfg.readOnly ? !cfg.readOnly() : true;
  setTop(cfg.title, {
    crumb: cfg.crumb,
    actions: [
      cfg.headerActions?.() || null,
      canWrite ? h('button.btn.btn-primary.btn-sm', { onclick: () => openForm() }, icon('plus'), `Add ${cfg.noun}`) : null,
    ],
  });

  const count = h('span.subtle');
  const bulkBar = h('div.row.hidden', { style: { '--gap': '8px' } });
  const toolbar = h('div.toolbar',
    cfg.search !== false ? h('div.search', icon('search'), h('input.input', { type: 'search', placeholder: cfg.search || 'Search…', 'aria-label': 'Search', oninput: debounce((e) => { query.q = e.target.value; load(); }, 250) })) : null,
    (cfg.toolbar || []).map((t) => h('select.select', { 'aria-label': t.label, onchange: (e) => { query[t.name] = e.target.value; load(); } }, h('option', { value: '' }, t.label), t.options().map(([v, l]) => h('option', { value: v }, l)))),
    bulkBar,
    h('span.grow'),
    count,
    h('button.btn.btn-sm', { onclick: exportList, title: 'Download this list as CSV (opens in Excel)' }, icon('download'), 'Export'),
    printButton());
  const body = h('div');
  el.append(cfg.intro || '', h('section.card', h('div.card-head', toolbar), body));

  let table;
  let lastRows = [];
  function exportList() {
    const cols = cfg.columns.filter((c) => c.key && c.export !== false && c.label);
    const plain = (c, r) => (c.export ? c.export(r) : typeof c.sort === 'function' ? c.sort(r) : r[c.key]);
    downloadCsv(`${cfg.endpoint.split('/').pop()}-${new Date().toISOString().slice(0, 10)}.csv`, cols.map((c) => c.label), lastRows.map((r) => cols.map((c) => plain(c, r))));
  }
  async function load() {
    const r = await api(`${cfg.endpoint}${qs({ ...query, limit: 2000 })}`);
    lastRows = r.rows;
    count.textContent = `${fmtInt(r.total)} ${r.total === 1 ? cfg.noun : cfg.nounPlural || cfg.noun + 's'}`;
    const cols = [...cfg.columns];
    if (canWrite) {
      cols.push({
        key: '_actions', label: '', sort: false, align: 'right',
        render: (row) => h('div.actions',
          h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Edit', 'aria-label': 'Edit', onclick: (e) => { e.stopPropagation(); openForm(row); } }, icon('edit')),
          cfg.canDelete === false ? null : h('button.btn.btn-ghost.btn-icon.btn-sm', { title: 'Delete', 'aria-label': 'Delete', onclick: (e) => { e.stopPropagation(); remove(row); } }, icon('trash'))),
      });
    }
    table = dataTable({
      columns: cols,
      rows: r.rows,
      empty: query.q ? 'No matches for your search.' : `No ${cfg.nounPlural || cfg.noun + 's'} yet. Add one, or bring them in with Data import.`,
      onRowClick: canWrite ? (row) => openForm(row) : undefined,
      select: cfg.bulk && canWrite ? (sel) => {
        bulkBar.classList.toggle('hidden', !sel.size);
        clear(bulkBar, h('span.chip.chip-primary', `${sel.size} selected`), cfg.bulk([...sel], () => { table.clearSelection(); load(); }));
      } : undefined,
    });
    clear(body, table);
  }

  async function remove(row) {
    const ok = await confirmDialog({
      title: `Delete this ${cfg.noun}?`,
      message: cfg.deleteMessage?.(row) || 'This cannot be undone. Records that are still in use cannot be deleted — deactivate them instead.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`${cfg.endpoint}/${row.id}`, { method: 'DELETE' });
      toast(`${cap(cfg.noun)} deleted.`);
      await loadMeta();
      load();
    } catch (ex) { toast(ex.message, 'bad'); }
  }

  function openForm(row) {
    const values = {};
    for (const f of cfg.fields) values[f.name] = row ? row[f.name] : typeof f.default === 'function' ? f.default() : f.default ?? '';
    const holders = {};
    const err = h('div.callout.bad.hidden', { role: 'alert' });

    const renderField = (f) => {
      const id = `fld-${f.name}`;
      let input;
      const set = (v) => {
        values[f.name] = v;
        for (const g of cfg.fields) if (g.dependsOn?.includes(f.name) && holders[g.name]) { if (g.reset !== false) values[g.name] = ''; holders[g.name].replaceWith(holders[g.name] = renderField(g)); }
      };
      if (f.type === 'select') {
        const opts = f.options(values);
        input = h('select.select', { id, required: f.required, onchange: (e) => set(e.target.value) },
          h('option', { value: '' }, f.placeholder || `Select ${f.label.toLowerCase()}`),
          opts.map(([v, l]) => h('option', { value: v, selected: String(values[f.name] ?? '') === String(v) }, l)));
      } else if (f.type === 'switch') {
        if (values[f.name] === '' || values[f.name] === undefined || values[f.name] === null) values[f.name] = f.default ?? 1;
        input = h('label.switch', h('input', { id, type: 'checkbox', checked: !!values[f.name], onchange: (e) => set(e.target.checked ? 1 : 0) }), h('span.track'), h('span', f.switchLabel || 'Active'));
        return h('div.field', h('span.label', f.label), input, f.hint ? h('span.hint', f.hint) : null);
      } else if (f.type === 'textarea') {
        input = h('textarea.textarea', { id, required: f.required, value: values[f.name] ?? '', oninput: (e) => set(e.target.value) });
      } else {
        input = h('input.input', { id, type: f.type || 'text', required: f.required && !(f.requiredOnCreate && row), placeholder: f.placeholder || '', list: f.datalist ? `${id}-list` : undefined, autocomplete: 'off', value: values[f.name] ?? '', oninput: (e) => set(e.target.value), style: f.upper ? { textTransform: 'uppercase' } : {} });
      }
      return h('div.field', { style: f.full ? { gridColumn: '1 / -1' } : {} },
        h('label', { for: id }, f.label, f.required && !(f.requiredOnCreate && row) ? h('span', { style: { color: 'var(--bad)' } }, ' *') : ''),
        input,
        f.datalist ? h('datalist', { id: `${id}-list` }, f.datalist.map((d) => h('option', { value: d }))) : null,
        f.hint ? h('span.hint', typeof f.hint === 'function' ? f.hint(row) : f.hint) : null);
    };
    const visible = cfg.fields.filter((f) => !f.hidden?.(values, row));
    const shown = new Set(visible.map((f) => f.name));
    const grid = h('div.form-grid', visible.map((f) => (holders[f.name] = renderField(f))));

    const m = modal({
      title: row ? `Edit ${cfg.noun}` : `Add ${cfg.noun}`,
      subtitle: row ? cfg.describe?.(row) : null,
      body: h('form.stack', { onsubmit: (e) => { e.preventDefault(); save(); } }, err, grid, h('button', { type: 'submit', hidden: true })),
      actions: [
        (close) => h('button.btn', { onclick: close }, 'Cancel'),
        () => h('button.btn.btn-primary', { onclick: save }, row ? 'Save changes' : `Add ${cfg.noun}`),
      ],
    });

    async function save() {
      err.classList.add('hidden');
      const body = {};
      for (const f of cfg.fields) {
        if (!shown.has(f.name)) continue;
        let v = values[f.name];
        if (typeof v === 'string') v = v.trim();
        if (v === '' && f.type !== 'switch') v = null;
        if (f.optional && v === null) continue;
        body[f.name] = v;
      }
      try {
        await api(row ? `${cfg.endpoint}/${row.id}` : cfg.endpoint, { method: row ? 'PUT' : 'POST', body });
        toast(row ? 'Changes saved.' : `${cap(cfg.noun)} added.`);
        m.close();
        await loadMeta();
        load();
      } catch (ex) {
        clear(err, icon('alert'), h('span', ex.message));
        err.classList.remove('hidden');
      }
    }
  }

  return load();
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* ------------------------------------------------------------- options */
export const deptOptions = () => state.meta.departments.map((d) => [d.id, `${d.code} — ${d.name}`]);
export const deptDefault = () => (isSuper() ? '' : state.me.department_id);
export const classOptions = (deptId) => state.meta.classes.filter((c) => !deptId || c.department_id === Number(deptId)).map((c) => [c.id, c.label]);
export const statusChip = (s) => h(`span.chip${s === 'active' || s === 1 ? '.chip-good' : s === 'graduated' ? '.chip-primary' : ''}`, h('span.dot'), s === 1 ? 'Active' : s === 0 ? 'Inactive' : cap(String(s)));
