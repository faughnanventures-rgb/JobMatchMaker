// Reads job postings straight from the hiring system each employer uses.
// Every adapter returns: [{ id, title, url, location, workplaceType, posted, closes, html | text, salary, commitment }]

import { decodeEntities, htmlToText } from './analyze.js';

const UA = 'Mozilla/5.0 (compatible; job-watch/1.0; personal job search, twice weekly)';
const MAX_BYTES = 6 * 1024 * 1024;

// Only public https addresses. Blocks localhost, private ranges, and cloud metadata addresses,
// so a bad link in a feed or in companies.json cannot point the runner at something internal.
export function safeTarget(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Not a valid web address'); }
  if (u.protocol !== 'https:') throw new Error(`Only https addresses are read (${u.protocol}//${u.host})`);
  if (u.username || u.password) throw new Error('Addresses with a login in them are not read');
  const h = u.hostname.toLowerCase();
  const privateHost = h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
    || /^\[/.test(h) || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || !h.includes('.');
  if (privateHost) throw new Error(`Address not allowed (${h})`);
  return u;
}

export async function get(url, opts = {}) {
  let target = safeTarget(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 25000);
  try {
    let res;
    for (let hop = 0; hop < 5; hop++) { // follow redirects by hand so every hop is checked
      res = await fetch(target, {
        method: opts.method || 'GET',
        headers: { 'User-Agent': UA, Accept: opts.json ? 'application/json' : 'text/html,*/*', ...(opts.headers || {}) },
        body: opts.body, signal: ctrl.signal, redirect: 'manual',
      });
      if (res.status < 300 || res.status >= 400 || !res.headers?.get?.('location')) break;
      const next = new URL(res.headers.get('location'), target);
      if (next.protocol === 'http:') next.protocol = 'https:';
      target = safeTarget(next.href);
      if (opts.sameHost && target.hostname !== new URL(url).hostname) throw new Error('Unexpected redirect to another site');
    }
    if (res.status === 403 || res.status === 401 || res.status === 429) throw new Error(`The site blocked the check (HTTP ${res.status} from ${target.host})`);
    if (res.status === 404 || res.status === 410) throw new Error(`Page not found (HTTP ${res.status} from ${target.host}). The link needs updating.`);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${target.host}`);
    if (Number(res.headers?.get?.('content-length') || 0) > MAX_BYTES) throw new Error('Response too large');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Response too large');
    return opts.json ? JSON.parse(text) : text;
  } finally { clearTimeout(timer); }
}

const TITLE_HINT = /environment|wildlife|biolog|ecolog|species|avian|habitat|permitting|nepa|siting|regulatory|natural resource|gis|geospatial|compliance|conservation|scien|policy|wetland|stewardship|restoration|monitor|field/i;
const TOKEN = /^[a-z0-9][a-z0-9_.-]{0,80}$/i;
const need = (v, what) => { if (!TOKEN.test(String(v || ''))) throw new Error(`Bad ${what} in company settings`); return v; };

// ---------- Greenhouse ----------
async function greenhouse({ token }) {
  const data = await get(`https://boards-api.greenhouse.io/v1/boards/${need(token, 'board name')}/jobs?content=true`, { json: true, sameHost: true });
  return (data.jobs || []).map((j) => ({
    id: j.id, title: j.title, url: j.absolute_url, location: j.location?.name || '',
    posted: j.first_published || j.updated_at, html: j.content || '',
  }));
}

// ---------- Lever ----------
async function lever({ token }) {
  const data = await get(`https://api.lever.co/v0/postings/${need(token, 'board name')}?mode=json`, { json: true, sameHost: true });
  return (Array.isArray(data) ? data : []).map((j) => ({
    id: j.id, title: j.text, url: j.hostedUrl, location: j.categories?.location || '',
    workplaceType: j.workplaceType === 'unspecified' ? '' : j.workplaceType,
    commitment: j.categories?.commitment || '', posted: j.createdAt,
    text: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${l.content}`), j.additionalPlain].filter(Boolean).join('\n'),
    salary: j.salaryRange ? { min: j.salaryRange.min, max: j.salaryRange.max, interval: j.salaryRange.interval } : null,
  }));
}

// ---------- Ashby ----------
async function ashby({ token }) {
  const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${need(token, 'board name')}?includeCompensation=true`, { json: true, sameHost: true });
  return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
    id: j.id, title: j.title, url: j.jobUrl, location: j.location || '',
    workplaceType: j.isRemote ? 'remote' : (j.workplaceType || ''), commitment: j.employmentType || '',
    posted: j.publishedAt,
    text: `${j.descriptionPlain || ''}\n${j.compensation?.compensationTierSummary || ''}`,
  }));
}

// ---------- Workday ----------
function workdayPosted(s) {
  const t = String(s || '').toLowerCase();
  const now = Date.now();
  if (/today/.test(t)) return new Date(now);
  if (/yesterday/.test(t)) return new Date(now - 864e5);
  const m = t.match(/(\d+)\+?\s*day/);
  return m ? new Date(now - Number(m[1]) * 864e5) : null;
}

async function workday({ host, tenant, site }) {
  if (!/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(String(host || ''))) throw new Error('Bad Workday address in company settings');
  need(tenant, 'Workday tenant'); need(site, 'Workday site');
  const ask = (b, offset) => get(`${b}/jobs`, {
    json: true, sameHost: true, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
  });
  // e.g. osv-edf.wd5.myworkdayjobs.com belongs to the tenant "edf"
  const tenants = [...new Set([tenant, tenant.replace(/^[a-z0-9]+-/i, '')])];
  let base = '', first = null, lastErr = null;
  for (const t of tenants) {
    try { first = await ask(`https://${host}/wday/cxs/${t}/${site}`, 0); base = `https://${host}/wday/cxs/${t}/${site}`; break; } catch (e) { lastErr = e; }
  }
  if (!first) throw lastErr;
  const list = [];
  for (let offset = 0; offset < 400; offset += 20) {
    const page = offset === 0 ? first : await ask(base, offset);
    list.push(...(page.jobPostings || []));
    if (!page.jobPostings?.length || list.length >= (page.total || 0)) break;
  }
  const out = [];
  for (const p of list.filter((x) => TITLE_HINT.test(x.title || '') && /^\/[\w\-./%~]+$/.test(x.externalPath || '')).slice(0, 30)) {
    let info = {};
    try { info = (await get(`${base}${p.externalPath}`, { json: true, sameHost: true })).jobPostingInfo || {}; } catch { /* keep list data */ }
    out.push({
      id: info.jobReqId || p.bulletFields?.[0] || p.externalPath, title: p.title,
      url: `https://${host}/${site}${p.externalPath}`,
      location: [p.locationsText, info.location, ...(info.additionalLocations || [])].filter(Boolean).join(', '),
      workplaceType: info.remoteType || '', commitment: info.timeType || '',
      posted: info.startDate || workdayPosted(p.postedOn), closes: info.endDate || null, html: info.jobDescription || '',
    });
  }
  return out;
}

// ---------- Breezy ----------
async function breezy({ token }) {
  const host = `${need(token, 'board name')}.breezy.hr`;
  const data = await get(`https://${host}/json`, { json: true, sameHost: true });
  const out = [];
  for (const j of (Array.isArray(data) ? data : []).filter((x) => TITLE_HINT.test(x.name || '')).slice(0, 30)) {
    let html = '';
    // Only open the detail page if it is on the same board we were told to read.
    try { if (new URL(j.url).hostname === host) html = await get(j.url, { sameHost: true }); } catch { /* list data only */ }
    const body = html.match(/<div[^>]+class="[^"]*description[^"]*"[\s\S]*?<\/div>\s*<\/div>/i)?.[0] || html;
    out.push({
      id: j.id || j.friendly_id, title: j.name, url: j.url,
      location: `${j.location?.name || ''}${j.location?.is_remote ? ' Remote' : ''}`.trim(),
      commitment: j.type?.name || '', posted: j.published_date, html: body,
    });
  }
  return out;
}

// ---------- BambooHR ----------
async function bamboohr({ token }) {
  const host = `${need(token, 'board name')}.bamboohr.com`;
  const data = await get(`https://${host}/careers/list`, { json: true, sameHost: true });
  const out = [];
  for (const j of (data.result || []).filter((x) => TITLE_HINT.test(x.jobOpeningName || '')).slice(0, 30)) {
    let d = {};
    try { d = (await get(`https://${host}/careers/${encodeURIComponent(j.id)}/detail`, { json: true, sameHost: true })).result?.jobOpening || {}; } catch { /* list data only */ }
    const loc = [j.location?.city, j.location?.state].filter(Boolean).join(', ');
    const remote = String(j.locationType) === '1' || j.isRemote;
    out.push({
      id: j.id, title: j.jobOpeningName, url: `https://${host}/careers/${j.id}`,
      location: `${loc}${remote ? ' Remote' : ''}`.trim(), workplaceType: String(j.locationType) === '2' ? 'hybrid' : '',
      commitment: j.employmentStatusLabel || '', posted: d.datePosted || null, html: `${d.description || ''} ${d.compensation || ''}`,
    });
  }
  return out;
}

// ---------- Workable ----------
async function workable({ token }) {
  const data = await get(`https://apply.workable.com/api/v1/widget/accounts/${need(token, 'board name')}?details=true`, { json: true, sameHost: true });
  return (data.jobs || []).map((j) => ({
    id: j.shortcode, title: j.title, url: j.url || j.shortlink,
    location: [j.city, j.state, j.country].filter(Boolean).join(', '), workplaceType: j.telecommuting ? 'remote' : '',
    commitment: j.employment_type || '', posted: j.published_on || j.created_at, html: j.description || '',
  }));
}

// ---------- SmartRecruiters ----------
async function smartrecruiters({ token }) {
  const base = `https://api.smartrecruiters.com/v1/companies/${need(token, 'company name')}/postings`;
  const data = await get(`${base}?limit=100`, { json: true, sameHost: true });
  const out = [];
  for (const j of (data.content || []).filter((x) => TITLE_HINT.test(x.name || '')).slice(0, 30)) {
    let d = {};
    try { d = await get(`${base}/${encodeURIComponent(j.id)}`, { json: true, sameHost: true }); } catch { /* list data only */ }
    const sec = d.jobAd?.sections || {};
    out.push({
      id: j.id, title: j.name, url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
      location: [j.location?.city, j.location?.region].filter(Boolean).join(', '),
      workplaceType: j.location?.remote ? 'remote' : (j.location?.hybrid ? 'hybrid' : ''), posted: j.releasedDate,
      html: [sec.jobDescription?.text, sec.qualifications?.text, sec.additionalInformation?.text].filter(Boolean).join(' '),
    });
  }
  return out;
}

// ---------- Recruitee ----------
async function recruitee({ token }) {
  const data = await get(`https://${need(token, 'board name')}.recruitee.com/api/offers/`, { json: true, sameHost: true });
  return (data.offers || []).map((j) => ({
    id: j.id, title: j.title, url: j.careers_url, location: j.location || [j.city, j.country].filter(Boolean).join(', '),
    workplaceType: j.remote ? 'remote' : (j.hybrid ? 'hybrid' : ''), posted: j.published_at || j.created_at,
    html: `${j.description || ''} ${j.requirements || ''}`,
  }));
}

// ---------- Rippling ----------
async function rippling({ token }) {
  const base = `https://api.rippling.com/platform/api/ats/v1/board/${need(token, 'board name')}/jobs`;
  const data = await get(base, { json: true, sameHost: true });
  const out = [];
  for (const j of (Array.isArray(data) ? data : []).filter((x) => TITLE_HINT.test(x.name || '')).slice(0, 30)) {
    let d = {};
    try { d = await get(`${base}/${encodeURIComponent(j.uuid)}`, { json: true, sameHost: true }); } catch { /* list data only */ }
    out.push({
      id: j.uuid, title: j.name, url: `https://ats.rippling.com/${token}/jobs/${j.uuid}`,
      location: j.workLocation?.label || [].concat(d.workLocations || []).join('; '),
      commitment: d.employmentType?.label || '', posted: d.createdOn || null,
      html: `${d.description?.company || ''} ${d.description?.role || ''}`,
    });
  }
  return out;
}

// ---------- Paylocity ----------
async function paylocity({ token }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) throw new Error('Bad Paylocity board id in company settings');
  const page = await get(`https://recruiting.paylocity.com/recruiting/jobs/All/${token}`, { sameHost: true });
  const m = page.match(/window\.pageData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error('The Paylocity page layout was not recognised');
  const out = [];
  for (const j of (JSON.parse(m[1]).Jobs || []).filter((x) => TITLE_HINT.test(x.JobTitle || '')).slice(0, 30)) {
    const url = `https://recruiting.paylocity.com/Recruiting/Jobs/Details/${encodeURIComponent(j.JobId)}`;
    let html = '';
    try { html = await get(url, { sameHost: true }); } catch { /* list data only */ }
    out.push({ id: j.JobId, title: j.JobTitle, url, location: `${j.LocationName || ''}${j.IsRemote ? ' Remote' : ''}`.trim(), posted: j.PublishedDate, html });
  }
  return out;
}

// ---------- UKG (UltiPro) ----------
async function ukg({ host, tenant, board }) {
  if (!/^recruiting2?\.ultipro\.com$/i.test(String(host || '')) || !/^[0-9a-f-]{36}$/i.test(String(board || ''))) throw new Error('Bad UKG address in company settings');
  const root = `https://${host}/${need(tenant, 'UKG tenant')}/JobBoard/${board}`;
  const data = await get(`${root}/JobBoardView/LoadSearchResults`, {
    json: true, sameHost: true, method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ opportunitySearch: { Top: 200, Skip: 0, QueryString: '', OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }], Filters: [] }, matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] } }),
  });
  const out = [];
  for (const j of (data.opportunities || []).filter((x) => TITLE_HINT.test(x.Title || '')).slice(0, 30)) {
    const url = `${root}/OpportunityDetail?opportunityId=${encodeURIComponent(j.Id)}`;
    let html = '';
    try {
      const page = await get(url, { sameHost: true });
      const m = page.match(/"Description"\s*:\s*("(?:[^"\\]|\\.)*")/);
      html = m ? JSON.parse(m[1]) : page;
    } catch { /* list data only */ }
    const loc = (j.Locations || []).map((l) => l.LocalizedDescription || l.LocalizedName || [l.Address?.City, l.Address?.State?.Code].filter(Boolean).join(', ')).filter(Boolean).join('; ');
    out.push({ id: j.Id, title: j.Title, url, location: loc, posted: j.PostedDate, html: `${html} ${j.BriefDescription || ''}` });
  }
  return out;
}

// ---------- ADP Workforce Now ----------
async function adp({ cid, ccId }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(cid || '')) || !/^[\w-]{1,60}$/.test(String(ccId || ''))) throw new Error('Bad ADP address in company settings');
  const q = `cid=${cid}&ccId=${ccId}&lang=en_US&locale=en_US`;
  const root = 'https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions';
  const data = await get(`${root}?${q}&$top=100`, { json: true, sameHost: true });
  const out = [];
  for (const j of (data.jobRequisitions || []).filter((x) => TITLE_HINT.test(x.requisitionTitle || '')).slice(0, 30)) {
    let d = {};
    try { d = await get(`${root}/${encodeURIComponent(j.itemID)}?${q}`, { json: true, sameHost: true }); } catch { /* list data only */ }
    const loc = (j.requisitionLocations || []).map((l) => l.nameCode?.shortName || [l.address?.cityName, l.address?.countrySubdivisionLevel1?.codeValue].filter(Boolean).join(', ')).filter(Boolean).join('; ');
    out.push({
      id: j.itemID, title: j.requisitionTitle, location: loc, posted: j.postDate, commitment: j.workLevelCode?.shortName || '',
      url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${cid}&ccId=${ccId}&jobId=${encodeURIComponent(j.itemID)}&lang=en_US`,
      html: d.requisitionDescription || '',
    });
  }
  return out;
}

// ---------- iCIMS ----------
// The plain version of an iCIMS careers site (in_iframe=1) is ordinary HTML: a list of links, then a page per job.
async function icims({ host }) {
  if (!/^[a-z0-9-]+\.icims\.com$/i.test(String(host || ''))) throw new Error('Bad iCIMS address in company settings');
  const found = new Map();
  for (let page = 0; page < 6; page++) {
    const html = await get(`https://${host}/jobs/search?ss=1&in_iframe=1&pr=${page}`, { sameHost: true });
    const before = found.size;
    for (const m of html.matchAll(/<a\b[^>]*?href=["'](https:\/\/[^"']+?\/jobs\/(\d+)\/[^"']*?)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
      if (found.has(m[2])) continue;
      const fromAttr = m[0].match(/title=["']\s*\d+\s*-\s*([^"']+)["']/i)?.[1];
      const title = decodeEntities(fromAttr || m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/^(job )?title:?\s*/i, '').trim();
      if (title.length >= 4 && title.length <= 140) found.set(m[2], title);
    }
    if (found.size === before) break;
  }
  if (!found.size) throw new Error('The iCIMS page layout was not recognised');
  const out = [];
  for (const [id, title] of [...found].filter(([, t]) => TITLE_HINT.test(t)).slice(0, 30)) {
    const url = `https://${host}/jobs/${id}/job`;
    let html = '';
    try { html = await get(`${url}?in_iframe=1`, { sameHost: true }); } catch { /* list data only */ }
    const text = htmlToText(html);
    const posted = text.match(/Posted Date[^()\n]{0,40}\((\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || null;
    const location = (text.match(/(?:Job )?Locations?\s*:?\s*\n?\s*([A-Z]{2}-[^\n|]{0,80})/)?.[1] || '').trim();
    out.push({ id, title, url, location, posted, html });
  }
  return out;
}

// ---------- Last resort: read job links straight off the careers page ----------
const JOBISH = /\/jobs?\/|\/careers?\/.*\d|\/positions?\/|\/openings?\/|\/vacanc|\/requisition|\/posting|\/opportunit|gh_jid=|job_?id=|\/apply\//i;
export function linkJobs(html, pageUrl) {
  const base = new URL(pageUrl), seen = new Set(), out = [];
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let u; try { u = safeTarget(new URL(m[1], base).href); } catch { continue; }
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (title.length < 8 || title.length > 110 || !TITLE_HINT.test(title) || !JOBISH.test(u.pathname + u.search)) continue;
    if (/^(view|see|browse|search|all|our|explore|learn|read|apply|join|meet)\b/i.test(title) || /(careers?|jobs|opportunities|openings|positions)$/i.test(title)) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href); out.push({ title, url: u.href });
  }
  return out;
}
const tinyHash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };

// ---------- Fallback: schema.org JobPosting data in the page ----------
function jsonLdJobs(html, pageUrl) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const items = [].concat(data?.['@graph'] || data);
    for (const j of items) {
      if (!j || j['@type'] !== 'JobPosting') continue;
      const base = j.baseSalary?.value || {};
      out.push({
        id: j.identifier?.value || j.url || j.title, title: j.title, url: j.url || pageUrl,
        location: [].concat(j.jobLocation || []).map((l) => [l?.address?.addressLocality, l?.address?.addressRegion].filter(Boolean).join(', ')).join('; '),
        workplaceType: j.jobLocationType === 'TELECOMMUTE' ? 'remote' : '', commitment: String(j.employmentType || ''),
        posted: j.datePosted, closes: j.validThrough || null, html: j.description || '',
        salary: base.minValue ? { min: base.minValue, max: base.maxValue, interval: base.unitText } : null,
      });
    }
  }
  return out;
}

// ---------- Work out which system a careers page uses ----------
export function detect(text) {
  let m;
  if ((m = text.match(/greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i))) return { ats: 'greenhouse', token: m[1] };
  if ((m = text.match(/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)/i)) && m[1] !== 'embed') return { ats: 'greenhouse', token: m[1] };
  if ((m = text.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i))) return { ats: 'lever', token: m[1] };
  if ((m = text.match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i))) return { ats: 'ashby', token: m[1] };
  if ((m = text.match(/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/))) {
    return { ats: 'workday', host: `${m[1]}.${m[2]}.myworkdayjobs.com`, tenant: m[1], site: m[3] };
  }
  if ((m = text.match(/([a-z0-9-]+)\.breezy\.hr/i)) && m[1] !== 'app' && m[1] !== 'www') return { ats: 'breezy', token: m[1] };
  if ((m = text.match(/([a-z0-9-]+)\.bamboohr\.com/i)) && !['www', 'app', 'api', 'resources', 'help'].includes(m[1].toLowerCase())) return { ats: 'bamboohr', token: m[1] };
  if ((m = text.match(/apply\.workable\.com\/(?:api\/v\d\/widget\/accounts\/)?([a-z0-9-]+)/i)) && m[1] !== 'api') return { ats: 'workable', token: m[1] };
  if ((m = text.match(/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/))) return { ats: 'smartrecruiters', token: m[1] };
  if ((m = text.match(/([a-z0-9-]+)\.recruitee\.com/i)) && !['www', 'app', 'api'].includes(m[1].toLowerCase())) return { ats: 'recruitee', token: m[1] };
  if ((m = text.match(/ats\.rippling\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([a-z0-9-]+)\/jobs/i))) return { ats: 'rippling', token: m[1] };
  if ((m = text.match(/recruiting\.paylocity\.com\/recruiting\/jobs\/(?:All|List)\/([0-9a-f-]{36})/i))) return { ats: 'paylocity', token: m[1] };
  if ((m = text.match(/(recruiting2?\.ultipro\.com)\/([A-Za-z0-9]+)\/JobBoard\/([0-9a-f-]{36})/i))) return { ats: 'ukg', host: m[1].toLowerCase(), tenant: m[2], board: m[3] };
  if ((m = text.match(/workforcenow\.adp\.com\/[^"'\s<>]*?[?&]cid=([0-9a-f-]{36})[^"'\s<>]*?[?&](?:amp;)?ccId=([\w-]+)/i))) return { ats: 'adp', cid: m[1], ccId: m[2] };
  if ((m = text.match(/([a-z0-9-]+)\.icims\.com/i)) && !['www', 'social', 'api', 'login'].includes(m[1].toLowerCase())) return { ats: 'icims', host: `${m[1].toLowerCase()}.icims.com` };
  return null;
}

// Hiring systems we can recognise but not read yet. Naming them makes the fix list useful.
const UNSUPPORTED = [
  ['UKG', /ultipro\.com|\.ukg\.(com|net)/i], ['ADP', /workforcenow\.adp\.com|myjobs\.adp\.com/i],
  ['Jobvite', /jobvite\.com/i], ['JazzHR', /applytojob\.com/i], ['Paycom', /paycomonline/i], ['Dayforce', /dayforcehcm\.com/i],
  ['Taleo', /taleo\.net/i], ['SuccessFactors', /successfactors/i], ['USAJOBS', /usajobs\.gov/i], ['Teamtailor', /teamtailor\.com/i],
  ['Pinpoint', /pinpointhq\.com/i], ['Oracle', /oraclecloud\.com/i], ['Paycor', /paycor\.com/i], ['Trinet or Zenefits', /hire\.trinet\.com|zenefits\.com/i],
];
export const unsupported = (text) => UNSUPPORTED.find(([, re]) => re.test(text))?.[0] || null;

// Links on a careers page that probably lead to the job list on the same site.
export function candidateLinks(html, pageUrl) {
  const base = new URL(pageUrl);
  const site = base.hostname.split('.').slice(-2).join('.');
  const seen = new Set([base.href]);
  const out = [];
  for (const m of html.matchAll(/<(a|iframe)\b[^>]*?(?:href|src)=["']([^"'#]+)["'][^>]*>([\s\S]{0,160}?)(?=<\/a>|<)/gi)) {
    let u; try { u = new URL(m[2], base); } catch { continue; }
    if (u.protocol !== 'https:' || !u.hostname.endsWith(site) || seen.has(u.href)) continue;
    if (/\.(pdf|png|jpe?g|svg|css|js|zip|docx?)$/i.test(u.pathname)) continue;
    const hint = `${u.pathname} ${m[3]}`;
    if (m[1].toLowerCase() === 'iframe' || /open(ing| position| role)|job|career|vacanc|position|join[- ]|work[- ]with|employment|opportunit/i.test(hint)) { seen.add(u.href); out.push(u.href); }
  }
  return out;
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
async function guessGreenhouse(company) {
  const name = norm(company.name);
  let label = '';
  try { label = norm(new URL(company.careers).hostname.replace(/^www\./, '').split('.')[0]); } catch { /* no link */ }
  const core = name.replace(/(cleanenergy|renewableenergy|renewables|energy|power|solar|group|inc|llc)$/, '');
  for (const token of [...new Set([name, label, core])].filter((t) => t.length >= 5).slice(0, 3)) {
    try {
      const board = await get(`https://boards-api.greenhouse.io/v1/boards/${token}`, { json: true, sameHost: true });
      const b = norm(board.name);
      if (b.length >= 5 && (b.includes(core) || name.includes(b))) return { ats: 'greenhouse', token };
    } catch { /* no such board */ }
  }
  return null;
}

const ADAPTERS = { greenhouse, lever, ashby, workday, breezy, bamboohr, workable, smartrecruiters, recruitee, rippling, paylocity, icims, ukg, adp };

// Returns { method, jobs }. Throws with a plain-language reason when a site can't be read.
export async function fetchCompanyJobs(company, cache = {}) {
  const remembered = cache[company.id];
  let cfg = company.ats && company.ats !== 'auto' ? company : (remembered && (!remembered.from || remembered.from === company.careers) ? remembered : null);
  if (!cfg) cfg = detect(company.careers || '');
  let page = '';
  let careers = company.careers;
  if (!cfg) {
    if (!careers) throw new Error('No careers page set for this company');
    try {
      try { page = await get(careers); }
      catch (err) {
        // The careers link is dead. Look for the current one on the organisation's home page.
        if (!/Page not found/.test(err.message)) throw err;
        const home = new URL('/', careers).href;
        const front = await get(home);
        cfg = detect(front);
        for (const link of cfg ? [] : candidateLinks(front, home).slice(0, 3)) {
          try { page = await get(link); careers = link; break; } catch { /* try the next one */ }
        }
        if (!cfg && !page) throw err;
      }
    } catch (err) {
      // Blocked or missing: a Greenhouse board under the company's own name is still worth a try.
      cfg = await guessGreenhouse(company);
      if (!cfg) throw err;
    }
    cfg = cfg || detect(page);
    // Many careers pages keep the job list one click deeper. Look there too.
    for (const link of cfg || !page ? [] : candidateLinks(page, careers).slice(0, 4)) {
      try { const sub = await get(link); page += '\n' + sub; cfg = detect(sub); } catch { /* try the next link */ }
      if (cfg) break;
    }
  }
  if (cfg) {
    if (!Object.hasOwn(ADAPTERS, cfg.ats)) throw new Error(`Unknown hiring system "${cfg.ats}" in company settings`);
    const jobs = await ADAPTERS[cfg.ats](cfg);
    const { ats, token, host, tenant, site, board, cid, ccId } = cfg;
    return { method: ats, jobs, detected: { ats, token, host, tenant, site, board, cid, ccId } };
  }
  const jobs = jsonLdJobs(page, careers);
  if (jobs.length) return { method: 'page data', jobs };
  // No known hiring system: take job links from the page itself and read each posting.
  const links = linkJobs(page, careers).slice(0, 20);
  if (links.length) {
    const out = [];
    for (const l of links) {
      let html = '';
      try { html = await get(l.url); } catch { continue; }
      out.push({ id: tinyHash(l.url), title: l.title, url: l.url, location: '', html });
    }
    if (out.length) return { method: 'job links on the page', jobs: out };
  }
  const named = unsupported(page);
  if (!named) {
    const g = await guessGreenhouse(company);
    if (g) return { method: 'greenhouse', jobs: await greenhouse(g), detected: g };
  }
  if (named) throw new Error(`Uses ${named}, which this check cannot read yet.`);
  throw new Error('Could not tell which hiring system this careers page uses. Add its job board link to companies.json.');
}
