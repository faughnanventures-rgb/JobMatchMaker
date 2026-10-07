// Shared gatekeeping for the site's own functions: same-site only, JSON only, size cap.
// Tailored drafts also need a passphrase, checked in constant time with a brake on guessing.
// The other functions are open by the owner's choice and are held back by limits instead.
// The passcode is ACCESS_CODE (or the older TAILOR_CODE), 5 or more characters. It is set in Vercel, never in this code.
import { createHash, timingSafeEqual } from 'node:crypto';

export const MIN_CODE_LENGTH = 5;
const sameCode = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Covers one running copy of a function, so it slows a guesser down but is not a full rate limit.
const misses = new Map();
const WINDOW = 15 * 60 * 1000;
// A short code can be guessed by trying many, so wrong tries are also counted across all visitors:
// after 20 in an hour, the function refuses everyone for the rest of that hour.
let allMisses = { count: 0, first: 0 };
function tooManyMisses(who) {
  const r = misses.get(who);
  return (!!r && r.count >= 5 && Date.now() - r.first < WINDOW) || (allMisses.count >= 20 && Date.now() - allMisses.first < 3600000);
}
function noteMiss(who) {
  if (misses.size > 5000) misses.clear();
  const now = Date.now(), r = misses.get(who);
  if (now - allMisses.first > 3600000) allMisses = { count: 1, first: now }; else allMisses.count++;
  if (!r || now - r.first > WINDOW) misses.set(who, { count: 1, first: now }); else r.count++;
}

export const accessCode = () => process.env.ACCESS_CODE || process.env.TAILOR_CODE || '';

// A simple per-visitor counter for functions that are open without a passphrase.
const hits = new Map();
function overLimit(key, who, limit, windowMs) {
  if (hits.size > 5000) hits.clear();
  const k = `${key}:${who}`, now = Date.now(), r = hits.get(k);
  if (!r || now - r.first > windowMs) { hits.set(k, { count: 1, first: now }); return false; }
  return ++r.count > limit;
}

// Returns the parsed body, or null after sending the refusal.
// open: true skips the passphrase and applies a per-visitor limit instead.
export async function guard(req, res, { maxBody = 60000, needs = [], open = false, key = 'fn', limit = 30, windowMs = 3600000 } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use POST' }); return null; }
  const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
  let originHost = null;
  try { originHost = origin ? new URL(origin).host : null; } catch { /* leave null */ }
  if (!originHost || originHost !== host || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) { res.status(403).json({ error: 'Not allowed from this page' }); return null; }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { res.status(415).json({ error: 'Send JSON' }); return null; }
  const code = accessCode();
  if (needs.some((k) => !process.env[k]) || (!open && (!code || code.length < MIN_CODE_LENGTH))) { res.status(503).json({ error: 'Not set up' }); return null; }
  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ error: 'Bad request' }); return null; }
  if (JSON.stringify(body).length > maxBody) { res.status(413).json({ error: 'Too much text' }); return null; }
  const who = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (open) {
    if (overLimit(key, who, limit, windowMs)) { res.status(429).json({ error: 'Too many requests. Try again later.' }); return null; }
    return body;
  }
  if (tooManyMisses(who)) { res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes.' }); return null; }
  if (typeof body.code !== 'string' || !sameCode(body.code, code)) { noteMiss(who); await wait(600); res.status(401).json({ error: 'Wrong access code' }); return null; }
  return body;
}
