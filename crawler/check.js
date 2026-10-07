// The check itself, kept free of file and network access so it can be tested.
import { analyzeJob } from './analyze.js';

const KEEP_CLOSED_DAYS = 60;
const pick = ({ id, name, type, focus, region, hq, size, about, careers }) => ({ id, name, type, focus, region, hq, size, about, careers });

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const same = (a, b) => slug(a) === slug(b);

export async function runCheck({ companies, profile, prev, cache, fetchJobs, boards = [], env = {}, now = new Date(), log = () => {}, pause = async () => {} }) {
  const today = now.toISOString().slice(0, 10);
  const before = prev && !prev.sample && Array.isArray(prev.jobs) ? prev.jobs : [];
  const prevById = new Map(before.map((j) => [j.id, j]));
  const jobs = [];
  const health = [];

  for (const company of companies) {
    if (company.skip) { health.push({ companyId: company.id, ok: true, skipped: true, note: String(company.skip) }); continue; }
    const mine = before.filter((j) => j.companyId === company.id);
    try {
      const { method, jobs: raw, detected } = await fetchJobs(company, cache);
      if (detected) cache[company.id] = { ...detected, from: company.careers };
      const seen = new Set();
      let matched = 0;
      for (const r of raw) {
        if (!r || !r.title || !r.url) continue;
        const { job } = analyzeJob(r, company, profile, now);
        if (!job || seen.has(job.id)) continue;
        seen.add(job.id);
        const old = prevById.get(job.id);
        jobs.push({ ...job, firstSeen: old?.firstSeen || today, lastSeen: today, closed: false });
        matched++;
      }
      // Anything listed before that is gone from the board is now closed.
      for (const old of mine) {
        if (seen.has(old.id)) continue;
        const closedAt = old.closedAt || today;
        if ((now - new Date(closedAt)) / 864e5 <= KEEP_CLOSED_DAYS) jobs.push({ ...old, closed: true, closedAt });
      }
      health.push({ companyId: company.id, ok: true, method, postings: raw.length, matched });
      log(`ok    ${company.name}: ${raw.length} postings, ${matched} matched (${method})`);
    } catch (err) {
      jobs.push(...mine); // a failed read is not proof a job closed
      const reason = err?.name === 'AbortError' ? 'Site took too long to respond' : String(err?.message || err).slice(0, 200);
      health.push({ companyId: company.id, ok: false, error: reason });
      log(`FAIL  ${company.name}: ${reason}`);
    }
    await pause();
  }

  // ---- Job boards: a second source, marked as such, never duplicating a company-site job ----
  const boardHealth = [];
  const boardCompanies = new Map();
  // No company is filtered out of job board results. These words only add a caution note.
  const banned = new RegExp(`\\b(${(profile.excludeCompanyWords || []).join('|') || 'zzzz'})\\b`, 'i');
  const direct = jobs.filter((j) => !j.closed).map((j) => ({ title: j.title, company: companies.find((c) => c.id === j.companyId)?.name }));
  for (const b of boards) {
    if (b.off) { boardHealth.push({ name: b.name, ok: true, off: b.off }); continue; }
    const mine = before.filter((j) => j.board === b.name);
    try {
      const raw = await b.read(profile, env);
      const seen = new Set();
      const dropped = {};
      let matched = 0;
      for (const r of raw) {
        if (!r || !r.title || !r.url) continue;
        r.company = String(r.company || 'Company not named').trim() || 'Company not named';
        if (direct.some((d) => same(d.title, r.title) && same(d.company, r.company))) { dropped['already found on the company site'] = (dropped['already found on the company site'] || 0) + 1; continue; }
        const company = { id: `board-${slug(r.company)}`, name: String(r.company).slice(0, 120), type: 'other', focus: 'unknown', region: 'US', board: b.name, flagged: banned.test(r.company) };
        const res = analyzeJob(r, company, profile, now);
        const job = res.job;
        if (!job) { dropped[res.skip || 'other'] = (dropped[res.skip || 'other'] || 0) + 1; continue; }
        if (seen.has(job.id) || jobs.some((j) => j.id === job.id)) continue;
        seen.add(job.id);
        const old = prevById.get(job.id);
        jobs.push({ ...job, firstSeen: old?.firstSeen || today, lastSeen: today, closed: false });
        boardCompanies.set(company.id, { id: company.id, name: company.name, type: 'other', focus: 'unknown', region: 'US', board: b.name, about: `Found through ${b.name}. This company is not on the watched list, so its own site is not checked.`, careers: r.url });
        matched++;
      }
      for (const old of mine) {
        if (seen.has(old.id)) continue;
        const closedAt = old.closedAt || today;
        if ((now - new Date(closedAt)) / 864e5 <= KEEP_CLOSED_DAYS) { jobs.push({ ...old, closed: true, closedAt }); }
      }
      boardHealth.push({ name: b.name, ok: true, postings: raw.length, matched, dropped });
      log(`ok    ${b.name} (job board): ${raw.length} listings, ${matched} matched`);
    } catch (err) {
      jobs.push(...mine);
      const reason = err?.name === 'AbortError' ? 'Took too long to respond' : String(err?.message || err).replace(/app_key=[^&\s]+|app_id=[^&\s]+/g, 'key=hidden').slice(0, 200);
      boardHealth.push({ name: b.name, ok: false, error: reason });
      log(`FAIL  ${b.name} (job board): ${reason}`);
    }
    await pause();
  }
  // keep pop-up details for board jobs carried over from an earlier check
  for (const j of jobs) if (j.source === 'board' && !boardCompanies.has(j.companyId)) { const c = (prev?.companies || []).find((x) => x.id === j.companyId); if (c) boardCompanies.set(c.id, c); }

  return {
    boards: boardHealth,
    generatedAt: now.toISOString(),
    profile: { minBase: profile.minBase, contractMinHourly: profile.contractMinHourly },
    health, companies: [...companies.map(pick), ...boardCompanies.values()], jobs,
  };
}
