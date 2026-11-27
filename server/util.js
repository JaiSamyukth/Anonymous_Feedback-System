'use strict';

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** Parses "III", "III Year", "3", "Sem 5", "VI" → integer, or NaN. */
function parseOrdinal(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).trim().toLowerCase().replace(/(year|yr|semester|sem|\.|st|nd|rd|th)/g, ' ').trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  const token = s.split(/\s+/)[0];
  return ROMAN[token] ?? NaN;
}

function toRoman(n) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
}

function classLabel(c) {
  if (!c) return '';
  return `${c.department_code ? c.department_code + ' · ' : ''}${toRoman(c.year)} Year · Sem ${toRoman(c.semester)} · Sec ${c.section}`;
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

function int(v, { min = -Infinity, max = Infinity } = {}) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return NaN;
  return n;
}

/** Simple fixed-window rate limiter keyed by ip + bucket. */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, e] of hits) if (e.reset < now) hits.delete(k);
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    }
    next();
  };
}

module.exports = { HttpError, parseOrdinal, toRoman, classLabel, str, int, rateLimiter };
