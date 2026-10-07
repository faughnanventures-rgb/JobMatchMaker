// Quick checks for the matching rules. Run with: npm test
import assert from 'node:assert/strict';
import { analyzeJob, parseSalary, classifyRemote, relevance, htmlToText, parseDeadline } from '../crawler/analyze.js';
import { detect, fetchCompanyJobs, safeTarget, get, unsupported, candidateLinks, linkJobs } from '../crawler/adapters.js';
import { runCheck } from '../crawler/check.js';

const profile = { minBase: 80000, contractMinHourly: 55, homeState: 'Florida', homeStateAbbr: 'FL', totalYears: 12, renewableYears: 2, maxTravelPercent: 20, localPlaces: ['Juno Beach', 'Miami', 'Naples, FL'], fieldRegions: ['Costa Rica', 'Panama', 'Central America'], minBaseBarbados: 50000, barbadosPlaces: ['Barbados', 'Bridgetown'] };
const now = new Date('2026-10-03');

// Pay
assert.deepEqual(parseSalary('Compensation $130,000 - $165,000 base salary').text, '$130,000 to $165,000');
assert.equal(parseSalary('Pay range: $75K to $89K').min, 75000);
assert.equal(parseSalary('$75 - $89K salary').min, 75000);
assert.equal(parseSalary('The rate is $60 per hour').unit, 'hour');
assert.equal(parseSalary('a company with $16.6 billion in revenue'), null);
assert.equal(parseSalary('', { min: 90000, max: 110000, interval: 'per-year-salary' }).text, '$90,000 to $110,000');

// Remote
const r1 = classifyRemote({ location: 'Remote', text: 'The ideal candidate will be within commutable distance to the Houston, TX office location. However, this position may have the opportunity to work remotely.' }, profile);
assert.equal(r1.ok, true); assert.equal(r1.level, 'restricted'); assert.match(r1.note, /Houston/);
assert.equal(classifyRemote({ location: 'Houston, TX', workplaceType: 'hybrid', text: '' }, profile).ok, false);
assert.equal(classifyRemote({ location: 'Tucson, AZ', text: 'Great team.' }, profile).ok, false);
assert.equal(classifyRemote({ location: 'Remote - United States', text: 'This is a fully remote role.' }, profile).level, 'full');
assert.equal(classifyRemote({ location: 'Remote (California)', text: '' }, profile).level, 'preferred');
assert.equal(classifyRemote({ location: 'Audubon Florida - Remote', text: '' }, profile).level, 'full');
assert.equal(classifyRemote({ location: 'Bridgetown', text: '' }, profile, { region: 'Caribbean' }).level, 'barbados');
assert.equal(classifyRemote({ location: 'Bridgetown, Barbados', text: '' }, profile).level, 'barbados');

// Field and site work
assert.equal(classifyRemote({ location: 'Juno Beach, FL', text: '' }, profile).level, 'local');
assert.equal(classifyRemote({ location: 'Miami, FL', workplaceType: 'hybrid', text: '' }, profile).level, 'local');
assert.equal(classifyRemote({ location: 'San Jose, Costa Rica', text: '' }, profile).level, 'abroad');
assert.equal(classifyRemote({ location: 'Panama City, FL', text: '' }, profile).ok, false);
assert.equal(classifyRemote({ location: 'Naples, Italy', text: '' }, profile).ok, false);
assert.ok(relevance('Restoration Project Manager', 'river restoration and species monitoring with field work').fit.includes('habitat restoration'));

// Deadlines
assert.equal(parseDeadline('Application Deadline: July 15, 2026', now).closes, '2026-07-15');
assert.equal(parseDeadline('Applications close on 20 October 2026.', now).closes, '2026-10-20');
assert.equal(parseDeadline('Please apply by November 3.', now).closes, '2026-11-03');
assert.equal(parseDeadline('Closing date: 11/14/2026', now).closes, '2026-11-14');
assert.equal(parseDeadline('This position is open until filled.', now).closesNote, 'Open until filled');
assert.equal(parseDeadline('We were founded on July 15, 2010.', now).closes, null);

// Relevance
assert.equal(relevance('Senior Accounts Payable Specialist', 'solar permitting NEPA').ok, false);
assert.equal(relevance('Wildlife Biologist', '').ok, true);
assert.equal(relevance('Permitting Manager', 'NEPA and endangered species permitting for solar').ok, true);
assert.equal(relevance('Electrical Engineer', 'solar').ok, false);

// Full posting, modeled on a real solar permitting role
const html = '&lt;p&gt;The Permitting Manager will manage environmental compliance and permitting for solar and battery projects, including NEPA and endangered species review.&lt;/p&gt;&lt;p&gt;The ideal candidate will be within commutable distance to the Houston, TX office. However, this position may have the opportunity to work remotely. Travel up to 20% of the time.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Minimum of 7+ years of experience in environmental and regulatory compliance.&lt;/li&gt;&lt;li&gt;Minimum of 4+ years experience in utility-scale renewable development, required.&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Compensation $130,000 - $165,000 base salary&lt;/p&gt;';
const company = { id: 'acme-solar', name: 'Acme Solar', type: 'renewable', focus: 'mixed', region: 'US' };
const { job } = analyzeJob({ id: 1, title: 'Permitting Manager', url: 'https://example.com/1', location: 'Remote', posted: '2026-09-28T12:00:00Z', html }, company, profile, now);
assert.equal(job.pay.min, 130000);
assert.equal(job.posted, '2026-09-28'); assert.equal(job.closes, null);
assert.ok(analyzeJob({ id: 5, title: 'Wildlife Biologist', url: 'u', location: 'Remote', text: 'wildlife surveys. Apply by September 1, 2026.' }, company, profile, now).skip, 'past deadline is dropped');
assert.ok(job.fit.includes('NEPA') && job.fit.includes('solar'));
assert.ok(job.concerns.some((c) => /4\+ years in renewable/.test(c)));
assert.ok(job.concerns.some((c) => /no fossil fuels/.test(c)));
assert.ok(!job.concerns.some((c) => /Travel up to/.test(c)), '20% travel is within the limit');
assert.match(htmlToText(html), /Compensation \$130,000/);

// Filtered out
assert.ok(analyzeJob({ id: 2, title: 'Environmental Manager', url: 'u', location: 'Houston, TX', workplaceType: 'hybrid', html: 'NEPA wildlife permitting' }, company, profile, now).skip);
assert.ok(analyzeJob({ id: 3, title: 'Wildlife Biologist', url: 'https://x/3', location: 'Remote', text: 'Salary $50,000 - $60,000. wildlife surveys' }, company, profile, now).skip);
const straddle = analyzeJob({ id: 31, title: 'Wildlife Biologist', url: 'https://x/31', location: 'Remote', text: 'Salary $75,526 - $89,000. wildlife surveys' }, company, profile, now).job;
assert.ok(straddle && straddle.concerns.some((c) => /Low end of the range is under your \$80,000 floor/.test(c)), 'a range that reaches the floor is kept, with a note');
assert.ok(analyzeJob({ id: 34, title: 'Wildlife Biologist', url: 'https://x/34', location: 'Remote', text: 'Salary $70,000 - $79,999. wildlife surveys' }, company, profile, now).skip, 'a range that stops short of the floor is dropped');
assert.ok(analyzeJob({ id: 32, title: 'Wildlife Biologist', url: 'https://x/32', location: 'Remote', text: 'Salary $80,000 - $89,000. wildlife surveys' }, company, profile, now).job, 'a range that starts at the floor is kept');
assert.ok(analyzeJob({ id: 33, title: 'Wildlife Biologist', url: 'https://x/33', location: 'Remote', text: 'wildlife surveys, pay not stated' }, company, profile, now).job, 'no pay listed is kept');

// Barbados has its own, lower floor
const bb = (text) => analyzeJob({ id: 7, title: 'Environmental Scientist', url: 'https://x/7', location: 'Bridgetown, Barbados', text }, company, profile, now);
assert.ok(bb('wildlife and habitat work. Salary $55,000 - $60,000').job, 'a $55k Barbados job is kept');
assert.ok(bb('wildlife and habitat work. Salary $30,000 - $40,000').skip, 'a $40k Barbados job is dropped');
assert.equal(bb('wildlife and habitat work. Salary BBD $110,000 - $120,000').job.pay.min, 55000);
assert.ok(analyzeJob({ id: 8, title: 'Environmental Scientist', url: 'https://x/8', location: 'Remote', text: 'wildlife habitat. Salary $55,000 - $60,000' }, company, profile, now).skip, 'the same pay is still dropped for a remote US job');
assert.ok(analyzeJob({ id: 9, title: 'Wildlife Biologist', url: 'javascript:alert(1)', location: 'Remote', text: 'wildlife' }, company, profile, now).skip, 'script links are dropped');

// Only public https addresses are ever fetched
for (const bad of ['http://example.com', 'https://localhost/x', 'https://169.254.169.254/latest', 'https://10.0.0.5/', 'https://intranet/', 'https://user:pw@example.com/', 'file:///etc/passwd', 'https://[::1]/'])
  assert.throws(() => safeTarget(bad), undefined, bad);
assert.equal(safeTarget('https://boards-api.greenhouse.io/v1/boards/x/jobs').hostname, 'boards-api.greenhouse.io');
await assert.rejects(fetchCompanyJobs({ id: 'x', ats: 'greenhouse', token: '../../evil' }), /Bad board name/);
await assert.rejects(fetchCompanyJobs({ id: 'x', ats: 'workday', host: 'evil.example', tenant: 'a', site: 'b' }), /Bad Workday address/);
await assert.rejects(fetchCompanyJobs({ id: 'x', ats: 'constructor', token: 'a' }), /Unknown hiring system/);

// Hiring system detection
assert.deepEqual(detect('https://job-boards.greenhouse.io/174powerglobal/jobs/4014040009'), { ats: 'greenhouse', token: '174powerglobal' });
assert.equal(detect('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>').token, 'acme');
assert.equal(detect('<a href="https://jobs.lever.co/acme/123">').ats, 'lever');
assert.deepEqual(detect('https://audubon.wd503.myworkdayjobs.com/Audubon'), { ats: 'workday', host: 'audubon.wd503.myworkdayjobs.com', tenant: 'audubon', site: 'Audubon' });
assert.equal(detect('https://grid-united.breezy.hr/p/abc').token, 'grid-united');
assert.equal(detect('<html>nothing here</html>'), null);
assert.deepEqual(detect('<a href="https://acme.bamboohr.com/careers">'), { ats: 'bamboohr', token: 'acme' });
assert.deepEqual(detect('https://apply.workable.com/acme-wind/'), { ats: 'workable', token: 'acme-wind' });
assert.deepEqual(detect('https://careers.smartrecruiters.com/AcmeSolar'), { ats: 'smartrecruiters', token: 'AcmeSolar' });
assert.deepEqual(detect('https://ats.rippling.com/acme/jobs'), { ats: 'rippling', token: 'acme' });
assert.equal(detect('https://recruiting.paylocity.com/recruiting/jobs/All/0a1b2c3d-1111-2222-3333-444455556666/Acme').ats, 'paylocity');
assert.equal(unsupported('<iframe src="https://recruiting2.ultipro.com/ACME/JobBoard">'), 'UKG');
assert.equal(unsupported('plain page'), null);
assert.deepEqual(candidateLinks('<a href="/about">About</a><a href="/careers/open-positions">See open positions</a><a href="https://other.example/jobs">x</a><a href="/files/jobs.pdf">Jobs</a>', 'https://www.acme.org/careers'), ['https://www.acme.org/careers/open-positions']);

// Adapter with a stand-in for the network
const realFetch = globalThis.fetch;
const feed = JSON.stringify({ jobs: [{ id: 9, title: 'Permitting Manager', absolute_url: 'https://x/9', location: { name: 'Remote' }, first_published: '2026-10-01T00:00:00Z', content: html }] });
globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => feed });
const res = await fetchCompanyJobs({ id: 'acme', ats: 'greenhouse', token: 'acme' });
assert.equal(res.jobs[0].title, 'Permitting Manager'); assert.equal(res.method, 'greenhouse');

// A redirect to an internal address is refused
globalThis.fetch = async () => ({ ok: false, status: 302, headers: new Headers({ location: 'https://169.254.169.254/' }), text: async () => '' });
await assert.rejects(get('https://example.com/careers'), /not allowed/i);

// A careers page with the job board one click deeper, then a BambooHR feed
const pages = {
  'https://www.acme.org/careers': '<a href="/careers/openings">View openings</a>',
  'https://www.acme.org/careers/openings': '<script src="https://acme.bamboohr.com/js/embed.js"></script>',
  'https://acme.bamboohr.com/careers/list': JSON.stringify({ result: [{ id: 7, jobOpeningName: 'Wildlife Biologist', locationType: '1', location: { city: 'Miami', state: 'Florida' } }, { id: 8, jobOpeningName: 'Accountant' }] }),
  'https://acme.bamboohr.com/careers/7/detail': JSON.stringify({ result: { jobOpening: { description: '<p>wildlife surveys and NEPA</p>', datePosted: '2026-09-30' } } }),
};
globalThis.fetch = async (u) => { const body = pages[String(u)]; return { ok: body !== undefined, status: body !== undefined ? 200 : 404, headers: new Headers(), text: async () => body || '' }; };
const deep = await fetchCompanyJobs({ id: 'acme', careers: 'https://www.acme.org/careers', ats: 'auto' });
assert.equal(deep.method, 'bamboohr'); assert.equal(deep.jobs.length, 1); assert.match(deep.jobs[0].location, /Remote/);
assert.equal(deep.jobs[0].url, 'https://acme.bamboohr.com/careers/7');
// iCIMS: found through an iframe, list read from the plain version, one page per job
pages['https://www.acme.org/careers'] = '<iframe src="https://careers-acme.icims.com/jobs"></iframe>';
pages['https://careers-acme.icims.com/jobs/search?ss=1&in_iframe=1&pr=0'] = '<a href="https://careers-acme.icims.com/jobs/9575/wildlife-biologist/job?in_iframe=1" class="iCIMS_Anchor" title="9575 - Wildlife Biologist"><h3>Wildlife Biologist</h3></a><a href="https://careers-acme.icims.com/jobs/9580/accountant/job" title="9580 - Accountant"><h3>Accountant</h3></a>';
pages['https://careers-acme.icims.com/jobs/search?ss=1&in_iframe=1&pr=1'] = '<p>No more</p>';
pages['https://careers-acme.icims.com/jobs/9575/job?in_iframe=1'] = '<div>Job Locations</div><div>US-Remote</div><div>Posted Date 3 weeks ago(9/15/2026 2:13 PM)</div><p>Wildlife surveys and NEPA. This is a remote position. Pay range $82,000 - $95,000.</p>';
const ic = await fetchCompanyJobs({ id: 'acme', careers: 'https://www.acme.org/careers', ats: 'auto' });
assert.equal(ic.method, 'icims'); assert.equal(ic.jobs.length, 1);
assert.deepEqual([ic.jobs[0].title, ic.jobs[0].url, ic.jobs[0].posted, ic.jobs[0].location], ['Wildlife Biologist', 'https://careers-acme.icims.com/jobs/9575/job', '9/15/2026', 'US-Remote']);
const icJob = analyzeJob(ic.jobs[0], company, profile, now).job;
assert.ok(icJob && icJob.pay.min === 82000 && icJob.posted === '2026-09-15');

// A careers page with no known system: job links are read straight off the page
pages['https://www.acme.org/careers'] = '<a href="/about">About our conservation science</a><a href="/careers/jobs/1234-senior-wildlife-biologist">Senior Wildlife Biologist</a><a href="/careers/jobs/">View all conservation jobs</a><a href="/news/wildlife-biologist-wins-award">Wildlife Biologist wins award</a><a href="https://127.0.0.1/jobs/1">Environmental Scientist</a>';
pages['https://www.acme.org/careers/jobs/1234-senior-wildlife-biologist'] = '<h1>Senior Wildlife Biologist</h1><p>This is a fully remote role doing wildlife surveys.</p>';
assert.deepEqual(linkJobs(pages['https://www.acme.org/careers'], 'https://www.acme.org/careers').map((l) => l.title), ['Senior Wildlife Biologist']);
const lj = await fetchCompanyJobs({ id: 'acme', careers: 'https://www.acme.org/careers', ats: 'auto' });
assert.equal(lj.method, 'job links on the page'); assert.equal(lj.jobs.length, 1);
assert.ok(analyzeJob(lj.jobs[0], company, profile, now).job, 'a posting read this way still goes through the same matching');
pages['https://www.acme.org/careers'] = '<iframe src="https://recruiting2.ultipro.com/ACME/JobBoard"></iframe>';
await assert.rejects(fetchCompanyJobs({ id: 'acme', careers: 'https://www.acme.org/careers', ats: 'auto' }), /Uses UKG/);
await assert.rejects(fetchCompanyJobs({ id: 'acme', careers: 'https://www.acme.org/gone', ats: 'auto' }), /Page not found/);
globalThis.fetch = realFetch;

// Fixes from the first live run
{
  const P = {};
  globalThis.fetch = async (u, opts = {}) => {
    const key = String(u), hit = P[key];
    if (hit && hit.redirect) return { ok: false, status: 301, headers: new Headers({ location: hit.redirect }), text: async () => '' };
    if (typeof hit === 'function') return hit(opts);
    return { ok: hit !== undefined, status: hit !== undefined ? 200 : 404, headers: new Headers(), text: async () => hit || '' };
  };
  // a redirect to plain http is retried as https
  P['https://ccr.example/careers/'] = { redirect: 'http://new.example/' };
  P['https://new.example/'] = '<a href="https://jobs.lever.co/newco">Jobs</a>';
  P['https://api.lever.co/v0/postings/newco?mode=json'] = '[]';
  assert.equal((await fetchCompanyJobs({ id: 'c', name: 'CCR', careers: 'https://ccr.example/careers/', ats: 'auto' })).method, 'lever');
  // a dead careers link: the home page is checked for the current one
  P['https://www.org.example/'] = '<a href="/about">About</a><a href="/get-involved/careers">Careers</a>';
  P['https://www.org.example/get-involved/careers'] = '<a href="https://org.bamboohr.com/careers">Open roles</a>';
  P['https://org.bamboohr.com/careers/list'] = '{"result":[]}';
  assert.equal((await fetchCompanyJobs({ id: 'o', name: 'Org', careers: 'https://www.org.example/careers', ats: 'auto' })).method, 'bamboohr');
  // a blocked or unreadable site: a Greenhouse board is accepted only when its own name matches
  P['https://www.nexampish.com/careers'] = '<p>Loading...</p>';
  P['https://boards-api.greenhouse.io/v1/boards/nexampish'] = '{"name":"Nexampish"}';
  P['https://boards-api.greenhouse.io/v1/boards/nexampish/jobs?content=true'] = '{"jobs":[]}';
  const g = await fetchCompanyJobs({ id: 'n', name: 'Nexampish', careers: 'https://www.nexampish.com/careers', ats: 'auto' });
  assert.deepEqual([g.method, g.detected.token], ['greenhouse', 'nexampish']);
  P['https://www.scoutish.com/careers'] = '<p>Loading...</p>';
  P['https://boards-api.greenhouse.io/v1/boards/scoutish'] = '{"name":"A Different Company"}';
  await assert.rejects(fetchCompanyJobs({ id: 's', name: 'Scoutish', careers: 'https://www.scoutish.com/careers', ats: 'auto' }), /Could not tell/, 'a board with someone else\'s name is not used');
  // Workday host with a prefix: the tenant name is tried without it
  P['https://osv-edf.wd5.myworkdayjobs.com/wday/cxs/edf/Careers/jobs'] = '{"total":0,"jobPostings":[]}';
  assert.equal((await fetchCompanyJobs({ id: 'e', name: 'EDF', careers: 'https://osv-edf.wd5.myworkdayjobs.com/Careers', ats: 'auto' })).method, 'workday');
  // UKG and ADP are recognised and read
  assert.deepEqual(detect('https://recruiting.ultipro.com/NAT1047NWF/JobBoard/0a1b2c3d-1111-2222-3333-444455556666/?q='), { ats: 'ukg', host: 'recruiting.ultipro.com', tenant: 'NAT1047NWF', board: '0a1b2c3d-1111-2222-3333-444455556666' });
  P['https://recruiting.ultipro.com/NAT1047NWF/JobBoard/0a1b2c3d-1111-2222-3333-444455556666/JobBoardView/LoadSearchResults'] = JSON.stringify({ opportunities: [{ Id: 'abc', Title: 'Wildlife Biologist', PostedDate: '2026-09-20T00:00:00Z', Locations: [{ LocalizedDescription: 'Remote' }] }] });
  P['https://recruiting.ultipro.com/NAT1047NWF/JobBoard/0a1b2c3d-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=abc'] = '<script>var o = CandidateOpportunityDetail({"Title":"x","Description":"<p>Wildlife surveys. \\"Remote\\" role.<\/p>"});</script>';
  const u = await fetchCompanyJobs({ id: 'u', name: 'NWF', careers: 'https://recruiting.ultipro.com/NAT1047NWF/JobBoard/0a1b2c3d-1111-2222-3333-444455556666/', ats: 'auto' });
  assert.equal(u.method, 'ukg'); assert.match(u.jobs[0].html, /Wildlife surveys\. "Remote" role/); assert.equal(u.jobs[0].location, 'Remote');
  const ad = detect('<a href="https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=0a1b2c3d-1111-2222-3333-444455556666&amp;ccId=19000101_000001&amp;type=MP">');
  assert.deepEqual(ad, { ats: 'adp', cid: '0a1b2c3d-1111-2222-3333-444455556666', ccId: '19000101_000001' });
  globalThis.fetch = realFetch;
}

// Two checks in a row: new job, then it disappears, then a site fails
const co = [{ id: 'acme', name: 'Acme', type: 'renewable', focus: 'renewable', region: 'US' }, { id: 'beta', name: 'Beta', type: 'conservation', focus: 'conservation', region: 'US', skip: 'paused' }];
const posting = { id: 1, title: 'Wildlife Biologist', url: 'https://x/1', location: 'Remote', text: 'wildlife surveys and NEPA' };
const run1 = await runCheck({ companies: co, profile, prev: { sample: true, jobs: [{ id: 'acme:old', companyId: 'acme' }] }, cache: {}, fetchJobs: async () => ({ method: 'test', jobs: [posting, posting, null, { title: 'x' }] }), now: new Date('2026-10-05') });
assert.equal(run1.jobs.length, 1, 'starter rows are ignored and duplicates collapse');
assert.equal(run1.jobs[0].firstSeen, '2026-10-05'); assert.equal(run1.health[1].skipped, true);
const run2 = await runCheck({ companies: co, profile, prev: run1, cache: {}, fetchJobs: async () => { throw new Error('HTTP 500'); }, now: new Date('2026-10-08') });
assert.equal(run2.jobs[0].closed, false, 'a failed read does not close a job'); assert.equal(run2.health[0].ok, false);
const run3 = await runCheck({ companies: co, profile, prev: run2, cache: {}, fetchJobs: async () => ({ method: 'test', jobs: [] }), now: new Date('2026-10-12') });
assert.equal(run3.jobs[0].closed, true); assert.equal(run3.jobs[0].closedAt, '2026-10-12');
const run4 = await runCheck({ companies: co, profile, prev: run3, cache: {}, fetchJobs: async () => ({ method: 'test', jobs: [] }), now: new Date('2027-01-15') });
assert.equal(run4.jobs.length, 0, 'closed jobs drop off after 60 days');



// Job boards: marked, de-duplicated against company sites, fossil-named companies dropped, off boards reported
const bp = { ...profile, excludeCompanyWords: ['oil', 'gas'] };
const board = { name: 'TestBoard', read: async () => [
  { company: 'Acme', id: 'b1', title: 'Wildlife Biologist', url: 'https://b/1', workplaceType: 'remote', location: 'Remote', html: 'wildlife NEPA' },        // same as the company-site job
  { company: 'Green Org', id: 'b2', title: 'Endangered Species Biologist', url: 'https://b/2', workplaceType: 'remote', location: 'Remote (USA)', html: 'wildlife surveys' },
  { company: 'Big Oil Co', id: 'b3', title: 'Wildlife Biologist', url: 'https://b/3', workplaceType: 'remote', location: 'Remote', html: 'wildlife' },
] };
const br = await runCheck({ companies: [co[0]], profile: bp, prev: { jobs: [] }, cache: {}, fetchJobs: async () => ({ method: 'test', jobs: [posting] }), boards: [board, { name: 'OffBoard', off: 'Not set up.' }, { name: 'Broken', read: async () => { throw new Error('HTTP 500 app_key=SECRET'); } }], now: new Date('2026-10-05') });
const bj = br.jobs.filter((j) => j.source === 'board');
assert.equal(bj.length, 2, 'no company is filtered out of job board results'); assert.equal(bj[0].board, 'TestBoard'); assert.equal(bj[0].companyId, 'board-green-org');
assert.ok(bj[1].companyId === 'board-big-oil-co' && bj[1].concerns.some((c) => /oil, gas, coal, or mining/.test(c)), 'a fossil-sounding name gets a caution, not a removal');
assert.ok(!bj[0].concerns.some((c) => /oil, gas/.test(c)));
assert.ok(bj[0].concerns.some((c) => /Found on TestBoard/.test(c)));
assert.ok(br.companies.some((c) => c.id === 'board-green-org' && c.board === 'TestBoard'));
assert.deepEqual(br.boards.map((b) => [b.name, b.ok, !!b.off]), [['TestBoard', true, false], ['OffBoard', true, true], ['Broken', false, false]]);
assert.ok(!JSON.stringify(br.boards).includes('SECRET'), 'keys never reach the dashboard');
assert.deepEqual(br.boards[0].dropped, { 'already found on the company site': 1 }, 'the dashboard is told why board listings were dropped');

// Job board listings pass on title, location, and pay alone
const bco = { id: 'board-x', name: 'X', type: 'other', region: 'US', board: 'TestBoard' };
assert.ok(analyzeJob({ id: 'b9', title: 'GIS Analyst', url: 'https://b/9', workplaceType: 'remote', location: 'Remote', html: 'Join our team.' }, bco, profile, now).job, 'a thin description does not block a board job with a matching title');
assert.ok(analyzeJob({ id: 'b9', title: 'GIS Analyst', url: 'https://b/9', location: 'Remote', text: 'Join our team.' }, company, profile, now).skip, 'the same thin posting on a company site still needs backing');
assert.ok(analyzeJob({ id: 'b10', title: 'Compliance Analyst', url: 'https://b/10', workplaceType: 'remote', location: 'Remote', html: 'Bank compliance.' }, bco, profile, now).skip, 'an unrelated title is still dropped');
assert.ok(analyzeJob({ id: 'b11', title: 'Wildlife Biologist', url: 'https://b/11', workplaceType: 'remote', location: 'Remote', html: 'Salary $50,000 - $60,000' }, bco, profile, now).skip, 'pay under the floor is still dropped');
assert.ok(analyzeJob({ id: 'b12', title: 'Wildlife Biologist', url: 'https://b/12', location: 'Denver, CO', html: 'On site.' }, bco, profile, now).skip, 'a job that is not remote is still dropped');

console.log('All checks passed.');
