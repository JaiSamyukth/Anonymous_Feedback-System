import { h, clear, icon } from '../core.js';

/**
 * Client-side sortable table.
 * columns: [{ key, label, render?(row), sort?: (row)=>value | false, align?: 'right', width? }]
 */
export function dataTable({ columns, rows, onRowClick, empty = 'Nothing to show yet.', emptyIcon = 'list', initialSort, select }) {
  let sortKey = initialSort?.key;
  let dir = initialSort?.dir || 'desc';
  const selected = new Set();
  const tbody = h('tbody');
  const headRow = h('tr');
  const table = h('table.table', h('thead', headRow), tbody);
  const wrap = h('div.table-wrap', table);

  const valueOf = (c, r) => (typeof c.sort === 'function' ? c.sort(r) : r[c.key]);

  function paintHead() {
    clear(headRow,
      select ? h('th', { style: { width: '36px' } }, h('input', { type: 'checkbox', 'aria-label': 'Select all', checked: rows.length > 0 && selected.size === rows.length, onchange: (e) => { selected.clear(); if (e.target.checked) rows.forEach((r) => selected.add(r)); paintBody(); select(selected); paintHead(); } })) : null,
      columns.map((c) => {
        const sortable = c.sort !== false && c.key;
        const th = h(`th${c.align === 'right' ? '.right' : ''}${sortable ? '.sortable' : ''}`, { style: c.width ? { width: c.width } : {}, 'aria-sort': sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined },
          c.label, sortKey === c.key ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
        if (sortable) th.addEventListener('click', () => {
          if (sortKey === c.key) dir = dir === 'asc' ? 'desc' : 'asc';
          else { sortKey = c.key; dir = typeof valueOf(c, rows[0] || {}) === 'number' ? 'desc' : 'asc'; }
          paintHead();
          paintBody();
        });
        return th;
      }));
  }

  function paintBody() {
    let list = rows;
    if (sortKey) {
      const c = columns.find((x) => x.key === sortKey);
      list = [...rows].sort((a, b) => {
        const va = valueOf(c, a);
        const vb = valueOf(c, b);
        const cmp = va === vb ? 0 : va === null || va === undefined ? 1 : vb === null || vb === undefined ? -1 : typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    if (!list.length) {
      clear(tbody, h('tr', h('td', { colspan: columns.length + (select ? 1 : 0) }, h('div.empty', icon(emptyIcon), h('p', empty)))));
      return;
    }
    clear(tbody, list.map((r) => {
      const tr = h(`tr${onRowClick ? '.clickable' : ''}`,
        select ? h('td', { onclick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': 'Select row', checked: selected.has(r), onchange: (e) => { if (e.target.checked) selected.add(r); else selected.delete(r); select(selected); paintHead(); } })) : null,
        columns.map((c) => h(`td${c.align === 'right' ? '.right' : ''}${c.strong ? '.cell-strong' : ''}`, c.render ? c.render(r) : r[c.key] ?? '—')));
      if (onRowClick) {
        tr.tabIndex = 0;
        tr.addEventListener('click', () => onRowClick(r));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRowClick(r); });
      }
      return tr;
    }));
  }

  paintHead();
  paintBody();
  wrap.clearSelection = () => { selected.clear(); paintHead(); paintBody(); select?.(selected); };
  return wrap;
}
