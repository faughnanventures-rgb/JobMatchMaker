// Adds a company to the watch list, or gives an existing one a new careers link.
// POST { name, careers, type, id? }  Saves to data/companies.json in the repository.
// Open to anyone using the dashboard, limited to 12 an hour per visitor.
import { guard } from '../lib/guard.js';
import { gh, branch } from '../lib/github.js';
import { safeTarget } from '../crawler/adapters.js';

export const config = { maxDuration: 30 };
const TYPES = { renewable: 'renewable', conservation: 'conservation', consulting: 'consulting', other: 'unknown' };
const FILE = '/contents/data/companies.json';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

export default async function handler(req, res) {
  const body = await guard(req, res, { maxBody: 3000, needs: ['GITHUB_TOKEN', 'GITHUB_REPO'], open: true, key: 'company', limit: 12 });
  if (!body) return;
  const name = String(body.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 120);
  const type = Object.hasOwn(TYPES, body.type) ? body.type : 'other';
  let careers;
  try { careers = safeTarget(String(body.careers || '').trim().slice(0, 500)).href; } catch { return res.status(400).json({ error: 'The careers link must be a public https address.' }); }
  if (!name) return res.status(400).json({ error: 'A company name is needed.' });
  try {
    const file = await gh(`${FILE}?ref=${encodeURIComponent(branch())}`);
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (!Array.isArray(data.companies)) throw new Error('unexpected file shape');
    const wanted = typeof body.id === 'string' ? body.id : '';
    let entry = data.companies.find((c) => c.id === wanted) || data.companies.find((c) => slug(c.name) === slug(name));
    let added = false;
    if (entry) {
      entry.careers = careers; entry.ats = 'auto';
      for (const k of ['token', 'host', 'tenant', 'site', 'skip']) delete entry[k];
    } else {
      if (data.companies.length >= 300) return res.status(400).json({ error: 'The watch list is full.' });
      let id = slug(name) || 'company';
      while (data.companies.some((c) => c.id === id)) id = `${id}-2`;
      entry = { id, name, type, focus: TYPES[type], region: 'US', about: '', careers, ats: 'auto' };
      data.companies.push(entry); added = true;
    }
    await gh(FILE, { method: 'PUT', body: {
      // [skip ci] keeps a save from starting a check by itself. The dashboard asks for one, which the run gap controls.
      message: `${added ? 'Add' : 'Update link for'} ${entry.name}`.slice(0, 100) + ' [skip ci]', branch: branch(), sha: file.sha,
      content: Buffer.from(JSON.stringify(data, null, 1) + '\n', 'utf8').toString('base64'),
    } });
    return res.status(200).json({ ok: true, added, id: entry.id, name: entry.name });
  } catch (err) {
    console.error('company: github error', err?.status || err?.name || 'error');
    return res.status(502).json({ error: err?.status === 409 ? 'The list changed while saving. Try again.' : 'The change could not be saved to GitHub.' });
  }
}
