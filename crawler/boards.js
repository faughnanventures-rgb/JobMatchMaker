// Job boards. These are a second source, kept separate from the company sites and clearly
// marked on the dashboard. Each board returns: { name, jobs: [{ company, id, title, url, ... }] }.
// Only boards with a public feed meant for this kind of use are read. Two of them need a free key.
import { get } from './adapters.js';

const US_OK = /usa|united states|u\.s\.|north america|americas|worldwide|anywhere|global|^$/i;
const enc = encodeURIComponent;
// Single words find more on the small boards than whole phrases do.
const words = (profile) => profile.boardWords || ['environmental', 'wildlife', 'conservation', 'ecology', 'sustainability', 'permitting', 'biologist', 'gis'];

async function remotive(profile) {
  const jobs = [];
  for (const q of words(profile)) {
    const data = await get(`https://remotive.com/api/remote-jobs?search=${enc(q)}&limit=60`, { json: true, sameHost: true });
    for (const j of data.jobs || []) {
      if (!US_OK.test(j.candidate_required_location || '')) continue;
      jobs.push({
        company: j.company_name, id: `remotive-${j.id}`, title: j.title, url: j.url, workplaceType: 'remote',
        location: `Remote${j.candidate_required_location ? ' (' + j.candidate_required_location + ')' : ''}`,
        commitment: j.job_type || '', posted: j.publication_date, html: `${j.description || ''} ${j.salary ? 'Salary ' + j.salary : ''}`,
      });
    }
  }
  return jobs;
}

async function jobicy(profile) {
  const jobs = [];
  for (const q of words(profile)) {
    const data = await get(`https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa&tag=${enc(q)}`, { json: true, sameHost: true });
    for (const j of data.jobs || []) {
      const yearly = /year/i.test(j.salaryPeriod || 'yearly') && (j.salaryCurrency || 'USD') === 'USD';
      jobs.push({
        company: j.companyName, id: `jobicy-${j.id}`, title: j.jobTitle, url: j.url, workplaceType: 'remote',
        location: `Remote${j.jobGeo ? ' (' + j.jobGeo + ')' : ''}`, commitment: [].concat(j.jobType || []).join(', '),
        posted: j.pubDate, html: j.jobDescription || j.jobExcerpt || '',
        salary: yearly && j.annualSalaryMin ? { min: Number(j.annualSalaryMin), max: Number(j.annualSalaryMax || j.annualSalaryMin), interval: 'year' } : null,
      });
    }
  }
  return jobs;
}

// One feed of every listing. No key needed.
async function workingNomads() {
  const data = await get('https://www.workingnomads.com/api/exposed_jobs/', { json: true, sameHost: true });
  return (Array.isArray(data) ? data : []).filter((j) => US_OK.test(j.location || '')).map((j) => ({
    company: j.company_name, id: `workingnomads-${String(j.url || '').split('/').filter(Boolean).pop()}`, title: j.title, url: j.url,
    workplaceType: 'remote', location: `Remote${j.location ? ' (' + j.location + ')' : ''}`, posted: j.pub_date, html: j.description || '',
  }));
}

// Needs ADZUNA_APP_ID and ADZUNA_APP_KEY (free at developer.adzuna.com).
async function adzuna(profile, env) {
  const jobs = [];
  for (const q of profile.boardSearches || []) {
    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${enc(env.ADZUNA_APP_ID)}&app_key=${enc(env.ADZUNA_APP_KEY)}&results_per_page=50&max_days_old=45&what=${enc(q + ' remote')}`;
    const data = await get(url, { json: true, sameHost: true });
    for (const j of data.results || []) {
      const real = String(j.salary_is_predicted) !== '1' && j.salary_min;
      jobs.push({
        company: j.company?.display_name, id: `adzuna-${j.id}`, title: String(j.title || '').replace(/<[^>]+>/g, ''), url: j.redirect_url,
        location: j.location?.display_name || '', commitment: j.contract_type || '', posted: j.created, html: j.description || '',
        salary: real ? { min: Number(j.salary_min), max: Number(j.salary_max || j.salary_min), interval: 'year' } : null,
      });
    }
  }
  return jobs;
}

// Federal jobs. Needs USAJOBS_KEY and USAJOBS_EMAIL (free at developer.usajobs.gov).
async function usajobs(profile, env) {
  const jobs = [];
  const headers = { Host: 'data.usajobs.gov', 'User-Agent': env.USAJOBS_EMAIL, 'Authorization-Key': env.USAJOBS_KEY };
  for (const q of profile.boardSearches || []) {
    const data = await get(`https://data.usajobs.gov/api/search?ResultsPerPage=50&RemoteIndicator=True&Keyword=${enc(q)}`, { json: true, sameHost: true, headers });
    for (const item of data.SearchResult?.SearchResultItems || []) {
      const j = item.MatchedObjectDescriptor || {};
      const pay = (j.PositionRemuneration || [])[0] || {};
      const yearly = /PA|year/i.test(pay.RateIntervalCode || '');
      const d = j.UserArea?.Details || {};
      jobs.push({
        company: j.OrganizationName || j.DepartmentName, id: `usajobs-${j.PositionID || item.MatchedObjectId}`, title: j.PositionTitle, url: j.PositionURI,
        workplaceType: 'remote', location: `Remote (${j.PositionLocationDisplay || 'United States'})`, posted: j.PublicationStartDate, closes: j.ApplicationCloseDate,
        html: [d.JobSummary, [].concat(d.MajorDuties || []).join(' '), j.QualificationSummary].filter(Boolean).join(' '),
        salary: yearly && pay.MinimumRange ? { min: Number(pay.MinimumRange), max: Number(pay.MaximumRange || pay.MinimumRange), interval: 'year' } : null,
      });
    }
  }
  return jobs;
}

export function boardSources(env = {}) {
  return [
    { name: 'Remotive', read: remotive },
    { name: 'Jobicy', read: jobicy },
    { name: 'Working Nomads', read: workingNomads },
    env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY ? { name: 'Adzuna', read: adzuna } : { name: 'Adzuna', off: 'Not set up. Needs a free Adzuna key.' },
    env.USAJOBS_KEY && env.USAJOBS_EMAIL ? { name: 'USAJOBS', read: usajobs } : { name: 'USAJOBS', off: 'Not set up. Needs a free USAJOBS key.' },
  ];
}
