// Twice-weekly check. Reads every company's own job board, keeps the matches,
// and writes public/data/jobs.json for the dashboard.
import { readFile, writeFile } from 'node:fs/promises';
import { fetchCompanyJobs } from './adapters.js';
import { runCheck } from './check.js';
import { boardSources } from './boards.js';

const root = new URL('..', import.meta.url);
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(new URL(p, root), 'utf8')); } catch { return fallback; } };

const profile = await readJson('data/profile.json');
const list = await readJson('data/companies.json');
if (!profile || !Array.isArray(list?.companies)) { console.error('data/profile.json or data/companies.json is missing or not valid JSON.'); process.exit(1); }
const ids = list.companies.map((c) => c.id);
const dupes = ids.filter((id, i) => !/^[a-z0-9-]+$/.test(String(id)) || ids.indexOf(id) !== i);
if (dupes.length) { console.error(`Fix these company ids in data/companies.json (lowercase letters, numbers, dashes, no repeats): ${dupes.join(', ')}`); process.exit(1); }

const cache = await readJson('data/ats-cache.json', {});
const prev = await readJson('public/data/jobs.json', { jobs: [] });
const out = await runCheck({
  companies: list.companies, profile, prev, cache, fetchJobs: fetchCompanyJobs,
  boards: boardSources(process.env), env: process.env,
  log: console.log, pause: () => new Promise((r) => setTimeout(r, 700)),
});

// If nearly every site failed, something is wrong on our side. Keep the last good list.
const tried = out.health.filter((h) => !h.skipped);
const failed = tried.filter((h) => !h.ok).length;
if (tried.length >= 5 && failed / tried.length > 0.9 && !prev.sample && prev.jobs?.length) {
  console.error(`\n${failed} of ${tried.length} sites failed. Leaving the last good job list in place.`);
  process.exit(1);
}
await writeFile(new URL('public/data/jobs.json', root), JSON.stringify(out, null, 1));
await writeFile(new URL('data/ats-cache.json', root), JSON.stringify(cache, null, 1));
console.log(`\n${out.jobs.filter((j) => !j.closed).length} open matches. Read ${tried.length - failed} of ${tried.length} sites.`);
