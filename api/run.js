// Starts a job check on request and reports how far along it is.
// POST { action: "start" | "status" }  Open to anyone using the dashboard.
import { guard } from '../lib/guard.js';
import { gh, WORKFLOW, branch } from '../lib/github.js';

export const config = { maxDuration: 30 };
// With no passphrase, this gap is what stops someone from running checks back to back.
const MIN_GAP_MS = Math.max(5, Number(process.env.RUN_GAP_MINUTES) || 60) * 60 * 1000;

async function latest() {
  const runs = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  const run = (runs.workflow_runs || [])[0];
  if (!run) return null;
  const out = { id: run.id, status: run.status, conclusion: run.conclusion, startedAt: run.run_started_at || run.created_at, done: 0, total: 0, step: '' };
  if (run.status !== 'completed') {
    try {
      const steps = ((await gh(`/actions/runs/${run.id}/jobs`)).jobs || [])[0]?.steps || [];
      out.total = steps.length; out.done = steps.filter((s) => s.status === 'completed').length;
      out.step = String(steps.find((s) => s.status === 'in_progress')?.name || '').slice(0, 80);
    } catch { /* progress detail is optional */ }
  }
  return out;
}

export default async function handler(req, res) {
  const body = await guard(req, res, { maxBody: 1000, needs: ['GITHUB_TOKEN', 'GITHUB_REPO'], open: true, key: 'run', limit: 900 });
  if (!body) return;
  try {
    const run = await latest();
    if (body.action === 'status') return res.status(200).json({ ok: true, run });
    if (body.action !== 'start') return res.status(400).json({ error: 'Bad request' });
    if (run && run.status !== 'completed') return res.status(200).json({ ok: true, already: true, run });
    if (run && Date.now() - new Date(run.startedAt).getTime() < MIN_GAP_MS) return res.status(429).json({ error: `A check already ran in the last ${Math.round(MIN_GAP_MS / 60000)} minutes. The list is up to date as of then.` });
    await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: { ref: branch() } });
    return res.status(200).json({ ok: true, started: true });
  } catch (err) {
    console.error('run: github error', err?.status || err?.name || 'error');
    return res.status(502).json({ error: 'GitHub could not be reached, or the token does not have access.' });
  }
}
