// Shared UI helpers: element builder, icons, API client, toasts, modals, theme.

/** Hyperscript: h('div.card#id', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  let value;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'value') { value = v; continue; }
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el, ...children) => { el.replaceChildren(); append(el, children); return el; };

/* ------------------------------------------------------------------ icons */
const PATHS = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  mask: '<path d="M2 9c0-1 1-2 2-2 3 0 5 1 8 1s5-1 8-1c1 0 2 1 2 2 0 5-3 9-6 9-2 0-3-2-4-2s-2 2-4 2c-3 0-6-4-6-9z"/><circle cx="8" cy="11" r="1.4"/><circle cx="16" cy="11" r="1.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.8 3.5 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 10h.01M15 10h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  trendUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  graduation: '<path d="m2 9 10-5 10 5-10 5L2 9z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="${cls}" width="1.1em" height="1.1em" style="vertical-align:-0.18em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  return span.firstChild;
}

/* -------------------------------------------------------------------- api */
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') opts.headers['X-AFS'] = '1';
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      opts.body = body;
      opts.headers['Content-Type'] = 'application/octet-stream';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (raw && res.ok) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  return data;
}

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/* ----------------------------------------------------------------- toasts */
let toastHost;
export function toast(message, kind = 'good') {
  toastHost ||= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h(`div.toast.${kind}`, icon(kind === 'good' ? 'checkCircle' : kind === 'bad' ? 'alert' : 'info'), h('span', message));
  toastHost.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 5000 : 3200);
}

/* ----------------------------------------------------------------- modals */
export function modal({ title, subtitle, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head',
      h('div', h('h2', title), subtitle && h('p.muted', subtitle)),
      h('button.btn.btn-ghost.btn-icon', { onclick: close, 'aria-label': 'Close' }, icon('x'))),
    h('div.modal-body', body),
    actions.length ? h('div.modal-foot', actions.map((a) => (typeof a === 'function' ? a(close) : a))) : null,
  );
  const backdrop = h('div.modal-backdrop', { onmousedown: (e) => { if (e.target === backdrop) close(); } }, box);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input,select,textarea,button.btn-primary') || box).focus({ preventScroll: true }), 30);
  return { close, box };
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: h('p.muted', message),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        (close) => h('button.btn', { onclick: close }, 'Cancel'),
        (close) => h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, { onclick: () => { done = true; resolve(true); close(); } }, confirm),
      ],
    });
    return m;
  });
}

/* ------------------------------------------------------------------ theme */
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('afs-theme'); } catch { /* storage unavailable */ }
  if (saved) document.documentElement.dataset.theme = saved;
}
export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function themeToggle() {
  const btn = h('button.btn.btn-ghost.btn-icon', { 'aria-label': 'Toggle dark mode', title: 'Toggle dark mode' });
  const paint = () => clear(btn, icon(isDark() ? 'sun' : 'moon'));
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('afs-theme', next); } catch { /* ignore */ }
    paint();
    window.dispatchEvent(new Event('themechange'));
  });
  paint();
  return btn;
}

/* ---------------------------------------------------------------- formats */
export const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
export const fmtInt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'));
export const roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n ?? '');
export function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Score band: label + tone. Always rendered with text, never color alone. */
export function band(v) {
  if (v === null || v === undefined) return { label: 'No data', tone: '' };
  if (v >= 8) return { label: 'Excellent', tone: 'good' };
  if (v >= 6) return { label: 'Good', tone: 'warn' };
  return { label: 'Needs focus', tone: 'bad' };
}
export function bandChip(v) {
  const b = band(v);
  return h(`span.chip${b.tone ? '.chip-' + b.tone : ''}`, h('span.dot'), b.label);
}

export function ratingWord(v) {
  if (v === null || v === undefined) return 'Not rated yet';
  if (v >= 9.5) return 'Outstanding';
  if (v >= 8) return 'Very good';
  if (v >= 6.5) return 'Good';
  if (v >= 5) return 'Fair';
  if (v >= 3) return 'Needs improvement';
  return 'Poor';
}

export function initials(name) {
  return String(name || '?').replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
export function hueOf(str) {
  let x = 0;
  for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}
export function avatar(name, size) {
  return h('span.avatar', { style: { '--hue': hueOf(name), ...(size ? { width: size + 'px', height: size + 'px' } : {}) }, 'aria-hidden': 'true' }, initials(name));
}

export function scoreBar(v, max = 10) {
  return h('span.score', h('span.bar', h('i', { style: { width: `${Math.max(0, Math.min(100, ((v || 0) / max) * 100))}%` } })), h('b', fmt(v)));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = cd.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const LOGO = () => {
  const s = document.createElement('span');
  s.className = 'logo-mark';
  s.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="var(--primary)"/><path d="M11 13.5c0-1.4 1.1-2.5 2.5-2.5h13c1.4 0 2.5 1.1 2.5 2.5v9c0 1.4-1.1 2.5-2.5 2.5H19l-5 4v-4h-.5A2.5 2.5 0 0 1 11 22.5v-9z" fill="#fff"/><path d="m16 18 2.6 2.6L24.5 15" stroke="var(--accent)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return s;
};

/* ------------------------------------------------------------------ print */
/**
 * Print support: prints in the light theme, with a header naming the page,
 * the active filters (read from any .filters select) and the print date.
 */
export function setupPrint({ getTitle, getSubtitle, container }) {
  let prevTheme;
  window.addEventListener('beforeprint', () => {
    prevTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
    const host = container();
    if (!host) return;
    host.querySelector(':scope > .print-head')?.remove();
    const filters = [...document.querySelectorAll('.filters select')].map((s) => {
      const label = s.closest('.field')?.querySelector('label')?.textContent;
      return label ? `${label}: ${s.selectedOptions[0]?.textContent || ''}` : null;
    }).filter(Boolean);
    const tab = document.querySelector('.tabs [aria-selected="true"], .segmented [aria-pressed="true"]');
    host.prepend(h('div.print-head',
      h('div.ph-top', h('b', getSubtitle?.() || ''), h('span', `Printed ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`)),
      h('h1', getTitle() + (tab ? ` — ${tab.textContent}` : '')),
      filters.length ? h('p', filters.join('  ·  ')) : null,
      h('p.ph-note', 'Anonymous student feedback. Ratings on a 1–10 scale. No student identities are stored with responses.')));
  });
  window.addEventListener('afterprint', () => {
    if (prevTheme) document.documentElement.dataset.theme = prevTheme;
    else delete document.documentElement.dataset.theme;
    container()?.querySelector(':scope > .print-head')?.remove();
  });
}

export const printButton = (label = 'Print') => h('button.btn.btn-sm', { onclick: () => window.print(), title: 'Print or save as PDF' }, icon('printer'), label);

/** Downloads rows as a UTF-8 CSV that opens cleanly in Excel. */
export function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = '\ufeff' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
