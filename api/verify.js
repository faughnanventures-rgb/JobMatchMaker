// Tries a careers page link and says whether the check can read jobs from it.
// POST { url }  Open to anyone using the dashboard, limited to 30 an hour per visitor.
import { guard } from '../lib/guard.js';
import { fetchCompanyJobs, safeTarget } from '../crawler/adapters.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const body = await guard(req, res, { maxBody: 2000, open: true, key: 'verify', limit: 30 });
  if (!body) return;
  let url;
  try { url = safeTarget(String(body.url || '').trim().slice(0, 500)).href; }
  catch { return res.status(200).json({ ok: false, message: 'That is not a public https link. Copy the address from the careers page and try again.' }); }
  try {
    const { method, jobs } = await fetchCompanyJobs({ id: 'link-check', careers: url, ats: 'auto' });
    return res.status(200).json({ ok: true, url, system: method, postings: jobs.length, samples: jobs.slice(0, 5).map((j) => String(j.title || '').slice(0, 120)) });
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'The site took too long to respond.' : String(err?.message || err).slice(0, 200);
    return res.status(200).json({ ok: false, url, message });
  }
}
