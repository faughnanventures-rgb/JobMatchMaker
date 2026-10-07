// Checks for the run, verify, and company functions. Run with: npm test
import assert from 'node:assert/strict';

process.env.GITHUB_TOKEN = 'ghp_test'; process.env.GITHUB_REPO = 'owner/repo';
const run = (await import('../api/run.js')).default;
const verify = (await import('../api/verify.js')).default;
const company = (await import('../api/company.js')).default;

let ip = 0;
const call = async (fn, body, headers = {}) => {
  const req = { method: 'POST', headers: { origin: 'https://site.example', host: 'site.example', 'content-type': 'application/json', 'x-forwarded-for': `10.1.1.${++ip}`, ...headers }, body };
  const res = { code: 0, setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } };
  await fn(req, res); return res;
};
const realFetch = globalThis.fetch;
const calls = [];
const json = (status, data) => ({ ok: status < 300, status, headers: new Headers(), json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });

// ---- run ----
let runs = { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'success', run_started_at: new Date(Date.now() - 3600e3).toISOString() }] };
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', auth: opts.headers?.Authorization, body: opts.body });
  if (/\/runs\?per_page=1$/.test(url)) return json(200, runs);
  if (/\/runs\/5\/jobs$/.test(url)) return json(200, { jobs: [{ steps: [{ name: 'Set up job', status: 'completed' }, { name: 'Read the company job boards', status: 'in_progress' }, { name: 'Save results', status: 'queued' }] }] });
  if (/\/dispatches$/.test(url)) return { ok: true, status: 204, headers: new Headers(), json: async () => ({}) };
  return json(404, {});
};
assert.equal((await call(run, { action: 'start' }, { origin: 'https://evil.example' })).code, 403);
let r = await call(run, { action: 'start' });
assert.equal(r.code, 200); assert.equal(r.data.started, true);
const d = calls.find((c) => /dispatches$/.test(c.url));
assert.equal(d.method, 'POST'); assert.equal(d.auth, 'Bearer ghp_test'); assert.equal(d.url, 'https://api.github.com/repos/owner/repo/actions/workflows/check-jobs.yml/dispatches');
assert.ok(!JSON.stringify(r.data).includes('ghp_test'), 'the token is never sent to the browser');
runs = { workflow_runs: [{ id: 5, status: 'in_progress', conclusion: null, run_started_at: new Date().toISOString() }] };
r = await call(run, { action: 'start' });
assert.equal(r.data.already, true, 'a second start while one is running does not start another');
r = await call(run, { action: 'status' });
assert.deepEqual([r.data.run.done, r.data.run.total, r.data.run.step], [1, 3, 'Read the company job boards']);
runs = { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'success', run_started_at: new Date(Date.now() - 60e3).toISOString() }] };
assert.equal((await call(run, { action: 'start' })).code, 429, 'cannot start again right after a check');
runs = { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'success', run_started_at: new Date(Date.now() - 50 * 60e3).toISOString() }] };
assert.equal((await call(run, { action: 'start' })).code, 429, 'still refused 50 minutes later: the gap is an hour');
delete process.env.GITHUB_TOKEN;
assert.equal((await call(run, { action: 'status' })).code, 503, 'reports not set up when the token is missing');
process.env.GITHUB_TOKEN = 'ghp_test';

// ---- verify ----
globalThis.fetch = async (url) => {
  if (String(url) === 'https://www.acme.org/careers') return json(200, '<a href="https://boards.greenhouse.io/acme">Jobs</a>');
  if (String(url).startsWith('https://boards-api.greenhouse.io/v1/boards/acme/jobs')) return json(200, { jobs: [{ id: 1, title: 'Wildlife Biologist', absolute_url: 'https://x/1', location: { name: 'Remote' }, content: '' }] });
  return json(404, 'nope');
};
r = await call(verify, { url: 'https://www.acme.org/careers' });
assert.equal(r.data.ok, true); assert.equal(r.data.system, 'greenhouse'); assert.equal(r.data.postings, 1); assert.deepEqual(r.data.samples, ['Wildlife Biologist']);
r = await call(verify, { url: 'https://www.acme.org/missing' });
assert.equal(r.data.ok, false); assert.match(r.data.message, /Page not found/);
for (const bad of ['http://169.254.169.254/latest/meta-data', 'https://localhost/admin', 'file:///etc/passwd', 'not a link'])
  assert.equal((await call(verify, { url: bad })).data.ok, false, `refuses ${bad}`);

// ---- company ----
const list = { companies: [{ id: 'acme', name: 'Acme Solar', type: 'renewable', careers: 'https://old.example/careers', ats: 'greenhouse', token: 'old', skip: 'paused' }] };
let saved = null;
globalThis.fetch = async (url, opts = {}) => {
  if ((opts.method || 'GET') === 'GET') return json(200, { sha: 'abc', content: Buffer.from(JSON.stringify(list)).toString('base64') });
  saved = JSON.parse(opts.body); return json(200, {});
};
r = await call(company, { id: 'acme', name: 'Acme Solar', careers: 'https://acme.example/jobs', type: 'renewable' });
let out = JSON.parse(Buffer.from(saved.content, 'base64').toString());
assert.equal(r.data.added, false); assert.equal(saved.sha, 'abc');
assert.deepEqual(out.companies[0], { id: 'acme', name: 'Acme Solar', type: 'renewable', careers: 'https://acme.example/jobs', ats: 'auto' });
r = await call(company, { name: 'New <script>Wind</script> Co', careers: 'https://newwind.example/careers', type: 'bogus' });
out = JSON.parse(Buffer.from(saved.content, 'base64').toString());
assert.equal(r.data.added, true); assert.equal(out.companies[1].id, 'new-scriptwind-script-co'); assert.equal(out.companies[1].name, 'New scriptWind/script Co'); assert.equal(out.companies[1].type, 'other');
assert.equal((await call(company, { name: 'X', careers: 'http://10.0.0.1/' })).code, 400);
assert.equal((await call(company, { name: '', careers: 'https://a.example/' })).code, 400);
assert.match(saved.message, /\[skip ci\]$/, 'a save does not start a check by itself');

// With no passphrase, each visitor is limited instead
let last;
for (let i = 0; i < 13; i++) last = await call(company, { name: 'Flood ' + i, careers: 'https://flood.example/' }, { 'x-forwarded-for': '7.7.7.7' });
assert.equal(last.code, 429, 'the thirteenth save in an hour from one visitor is refused');
for (let i = 0; i < 31; i++) last = await call(verify, { url: 'not a link' }, { 'x-forwarded-for': '8.8.8.8' });
assert.equal(last.code, 429, 'the thirty-first link check in an hour from one visitor is refused');
assert.equal((await call(company, { name: 'X', careers: 'https://a.example/' }, { origin: 'https://evil.example' })).code, 403, 'other websites still cannot call it');

globalThis.fetch = realFetch;
console.log('Function checks passed.');
