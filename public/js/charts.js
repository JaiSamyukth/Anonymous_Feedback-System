// Lightweight SVG charts (single-series, one hue) with hover tooltips.
// Values and labels use text tokens; the bar color carries the series only.
import { fmt } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

let tip;
function showTip(e, html) {
  tip ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'chart-tip', role: 'tooltip' }));
  tip.innerHTML = html;
  tip.style.display = 'block';
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 12);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => tip && (tip.style.display = 'none');
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Rounded-end bar path anchored on the baseline (left for horizontal, bottom for vertical). */
function hBarPath(x, y, w, hgt, r = 4) {
  r = Math.min(r, w, hgt / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`;
}
function vBarPath(x, y, w, hgt, base, r = 4) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * Horizontal bars. items: [{label, value, ref?, tip?, onClick?}]
 * opts: {max=10, refLabel, labelWidth}
 */
export function hbar(items, opts = {}) { return fit((w) => hbarAt(items, { ...opts, width: w })); }
function hbarAt(items, { max = 10, refLabel = 'Reference', labelWidth = 150, rowH = 30, onClick, width = 640 } = {}) {
  const W = width;
  labelWidth = Math.min(labelWidth, Math.max(70, W * 0.38));
  const pad = 46;
  const H = items.length * rowH + 22;
  const plotW = W - labelWidth - pad;
  const x = (v) => labelWidth + (Math.max(0, v) / max) * plotW;
  const svg = s('svg', { class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bar chart' });
  const grid = s('g', { class: 'grid' });
  for (let t = 0; t <= max; t += max / 5) {
    grid.append(s('line', { x1: x(t), x2: x(t), y1: 0, y2: H - 20 }));
    grid.append(s('text', { x: x(t), y: H - 4, 'text-anchor': 'middle', class: 'axis-label' }, String(t)));
  }
  svg.append(grid);
  items.forEach((it, i) => {
    const y = i * rowH + 6;
    const bh = rowH - 14;
    const g = s('g', { class: 'mark' });
    const maxChars = Math.floor((labelWidth - 12) / 6.6);
    const label = it.label.length > maxChars ? it.label.slice(0, maxChars - 1) + '…' : it.label;
    g.append(s('text', { x: labelWidth - 10, y: y + bh / 2 + 4, 'text-anchor': 'end' }, label));
    const w = Math.max(0, x(it.value ?? 0) - labelWidth);
    if (it.value !== null && it.value !== undefined) {
      g.append(s('path', { class: `bar${it.dim ? ' dim' : ''}`, d: hBarPath(labelWidth, y, Math.max(w, 2), bh) }));
      let end = labelWidth + w;
      // Keep the value next to its bar; only step past the reference dot when they would collide.
      if (it.ref != null && x(it.ref) > end - 6 && x(it.ref) < end + 42) end = x(it.ref) + 5;
      g.append(s('text', { x: end + 7, y: y + bh / 2 + 4, class: 'val' }, fmt(it.value)));
    }
    if (it.ref !== null && it.ref !== undefined) {
      g.append(s('circle', { class: 'ref-dot', cx: x(it.ref), cy: y + bh / 2, r: 4.5 }));
    }
    const hit = s('rect', { class: 'hit', x: 0, y: y - 4, width: W, height: rowH });
    hit.addEventListener('mousemove', (e) =>
      showTip(e, `${esc(it.tip || it.label)}<br><b>${fmt(it.value)}</b> / ${max}${it.ref != null ? `<br>${esc(refLabel)}: <b>${fmt(it.ref)}</b>` : ''}${it.extra ? `<br>${esc(it.extra)}` : ''}`));
    hit.addEventListener('mouseleave', hideTip);
    const click = it.onClick || (onClick && (() => onClick(it)));
    if (click) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => { hideTip(); click(); }); }
    g.append(hit);
    svg.append(g);
  });
  return svg;
}

/** Vertical columns. items: [{label, value, tip?}] */
export function columns(items, opts = {}) { return fit((w) => columnsAt(items, { ...opts, width: w })); }
function columnsAt(items, { height = 220, max, unit = '', showEvery, width = 640 } = {}) {
  const W = width;
  const H = height;
  const left = 34;
  const bottom = 26;
  const top = 12;
  const mx = max ?? Math.max(1, ...items.map((i) => i.value || 0));
  const niceMax = max ?? niceCeil(mx);
  const plotW = W - left - 6;
  const plotH = H - bottom - top;
  const bw = plotW / Math.max(items.length, 1);
  const gap = Math.min(8, bw * 0.25);
  const y = (v) => top + plotH - (v / niceMax) * plotH;
  const svg = s('svg', { class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Column chart' });
  const grid = s('g', { class: 'grid' });
  for (let i = 0; i <= 4; i++) {
    const v = (niceMax / 4) * i;
    grid.append(s('line', { x1: left, x2: W, y1: y(v), y2: y(v) }));
    grid.append(s('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, Number.isInteger(v) ? v : v.toFixed(1)));
  }
  svg.append(grid);
  const every = showEvery || Math.ceil(items.length / Math.max(2, Math.floor(plotW / 56)));
  items.forEach((it, i) => {
    const x0 = left + i * bw + gap / 2;
    const g = s('g', { class: 'mark' });
    const v = it.value || 0;
    if (v > 0) g.append(s('path', { class: 'bar', d: vBarPath(x0, y(v), bw - gap, y(0) - y(v), y(0)) }));
    if (i % every === 0) g.append(s('text', { x: x0 + (bw - gap) / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, it.label));
    const hit = s('rect', { class: 'hit', x: left + i * bw, y: top, width: bw, height: plotH });
    hit.addEventListener('mousemove', (e) => showTip(e, `${esc(it.tip || it.label)}<br><b>${it.fmt ? it.fmt(v) : v}</b>${unit}`));
    hit.addEventListener('mouseleave', hideTip);
    g.append(hit);
    svg.append(g);
  });
  return svg;
}

/** Line chart for trends. items: [{label, value, tip?}] */
export function line(items, opts = {}) { return fit((w) => lineAt(items, { ...opts, width: w })); }
function lineAt(items, { height = 200, min = 0, max = 10, width = 640 } = {}) {
  const W = width;
  const H = height;
  const left = 34;
  const right = 40;
  const top = 16;
  const bottom = 28;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const inset = 30;
  const x = (i) => left + inset + (items.length === 1 ? (plotW - inset) / 2 : (i / (items.length - 1)) * (plotW - inset * 2));
  const y = (v) => top + plotH - ((v - min) / (max - min)) * plotH;
  const svg = s('svg', { class: 'chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Trend chart' });
  const grid = s('g', { class: 'grid' });
  for (let i = 0; i <= 5; i++) {
    const v = min + ((max - min) / 5) * i;
    grid.append(s('line', { x1: left, x2: W - right, y1: y(v), y2: y(v) }));
    grid.append(s('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, Number.isInteger(v) ? v : v.toFixed(1)));
  }
  svg.append(grid);
  const pts = items.map((it, i) => [x(i), y(it.value ?? min)]);
  if (pts.length > 1) {
    svg.append(s('path', { class: 'area', d: `M${pts[0][0]},${y(min)}L${pts.map((p) => p.join(',')).join('L')}L${pts.at(-1)[0]},${y(min)}Z` }));
    svg.append(s('path', { class: 'line', d: `M${pts.map((p) => p.join(',')).join('L')}` }));
  }
  items.forEach((it, i) => {
    const g = s('g', { class: 'mark' });
    g.append(s('circle', { class: 'pt', cx: pts[i][0], cy: pts[i][1], r: 5 }));
    g.append(s('text', { x: pts[i][0], y: pts[i][1] - 12, 'text-anchor': 'middle', class: 'val' }, fmt(it.value)));
    g.append(s('text', { x: pts[i][0], y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, it.label));
    const hit = s('rect', { class: 'hit', x: pts[i][0] - 30, y: top, width: 60, height: plotH + 10 });
    hit.addEventListener('mousemove', (e) => showTip(e, `${esc(it.tip || it.label)}<br>Average <b>${fmt(it.value)}</b>${it.extra ? `<br>${esc(it.extra)}` : ''}`));
    hit.addEventListener('mouseleave', hideTip);
    g.append(hit);
    svg.append(g);
  });
  return svg;
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Mini sparkbars for the live student summary (10 bars, 0-10). */
export function miniBars(values, { height = 64 } = {}) {
  const W = 220;
  const n = values.length;
  const bw = W / n;
  const svg = s('svg', { class: 'chart', width: '100%', viewBox: `0 0 ${W} ${height + 16}`, role: 'img', 'aria-label': 'Your ratings by question' });
  values.forEach((v, i) => {
    const x0 = i * bw + 3;
    const w = bw - 6;
    svg.append(s('rect', { class: 'bar-bg', x: x0, y: 0, width: w, height, rx: 4 }));
    if (v) {
      const hh = (v / 10) * height;
      svg.append(s('path', { class: 'bar', d: vBarPath(x0, height - hh, w, hh, height) }));
    }
    svg.append(s('text', { x: x0 + w / 2, y: height + 13, 'text-anchor': 'middle', class: 'axis-label' }, i + 1));
  });
  return svg;
}

/** Renders a chart at the container's real pixel width and re-renders on resize. */
function fit(build) {
  const box = document.createElement('div');
  box.className = 'chart-box';
  let last = 0;
  const draw = (w) => {
    w = Math.max(240, Math.floor(w));
    if (Math.abs(w - last) < 4) return;
    last = w;
    box.replaceChildren(build(w));
  };
  const ro = new ResizeObserver((entries) => { for (const e of entries) draw(e.contentRect.width); });
  ro.observe(box);
  box.replaceChildren(build(640));
  return box;
}
