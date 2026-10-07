// Turns a raw posting into a dashboard row: remote check, pay, fit, concerns.
// No names or personal details live here. Criteria come from data/profile.json.

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function htmlToText(html) {
  let s = decodeEntities(html); // Greenhouse sends escaped HTML
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|ul|ol)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

const sentences = (t) => String(t || '').split(/(?<=[.!?;])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const clip = (s, n = 200) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

// ---------- Pay ----------
export function parseSalary(text, structured) {
  if (structured && (structured.min || structured.max)) {
    const unit = /hour/i.test(structured.interval || '') ? 'hour' : 'year';
    return fmtPay(structured.min || structured.max, structured.max || structured.min, unit);
  }
  const t = String(text || '');
  const num = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
  const re = new RegExp(
    String.raw`\$\s?${num}\s*([kK])?(?:\s*(?:-|–|—|to|and)\s*\$?\s?${num}\s*([kK])?)?(\s*(?:\/|per|an|a)\s*(?:hour|hr|year|yr|annum))?`, 'g');
  let best = null;
  for (const m of t.matchAll(re)) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/^\s*(million|billion|bn|mm|m\b|b\b)/i.test(after)) continue;
    let a = Number(m[1].replace(/,/g, ''));
    let b = m[3] ? Number(m[3].replace(/,/g, '')) : null;
    if (m[2]) a *= 1000;
    if (m[4]) { b *= 1000; if (!m[2] && a < 1000) a *= 1000; }
    const around = t.slice(Math.max(0, m.index - 90), m.index + m[0].length + 40);
    let unit = null;
    if (/hour|hr/i.test(m[5] || '')) unit = 'hour';
    else if (a >= 20000) unit = 'year';
    else if (a >= 12 && a <= 400 && /hour|hourly|\/hr/i.test(around)) unit = 'hour';
    if (!unit) continue;
    if (b !== null && (b < a || b > a * 4)) b = null;
    const score = (/salary|compensation|pay|base|range|wage|rate/i.test(around) ? 2 : 0) + (b ? 1 : 0);
    const bbd = /\bBBD\b|\bBDS\b|Bds\$|Barbados dollars?/i.test(around); // pegged at 2 to 1 US dollar
    if (!best || score > best.score) best = { score, a: bbd ? a / 2 : a, b: b && bbd ? b / 2 : b, unit, bbd };
  }
  if (!best) return null;
  const pay = fmtPay(best.a, best.b ?? best.a, best.unit);
  if (best.bbd) pay.text += ' (converted from Barbados dollars)';
  return pay;
}

function fmtPay(min, max, unit) {
  const per = unit === 'hour' ? ' an hour' : '';
  const text = min === max ? money(min) + per : `${money(min)} to ${money(max)}${per}`;
  return { min, max, unit, text };
}

// ---------- Remote ----------
const REMOTE_SIGNAL = /\b(fully|100%|completely) remote\b|remote[- ]first|\b(this|the) (is a |position is |role is )(fully )?remote|remote (position|role|opportunity)|work(ing)? remotely|work from home|telecommut|#LI-Remote/i;
const RESTRICT = /must (currently )?(reside|live|be located|be based)|residents? of|classified as hybrid|(this|the) (position|role) is (a )?hybrid|days? (per|a|each) week (in|at) (the |our )?office|commuting distance|commutable distance|only (open|available) to candidates/i;
const PREFER = /prefer[a-z]*[^.\n]{0,70}(located|location|based|candidates|proximity|near|area|office|time zone)|(candidates?|position|role)[^.\n]{0,40}(located|based) (in|near|within|out of)|ideal candidate will be[^.\n]{0,30}(located|based|within)|emphasis (in|on) [A-Z]|focus(ed)? on [^.\n]{0,30}(western|eastern|midwest|southwest|northeast|southeast|pacific)/i;

function leftoverLocation(loc) {
  return String(loc || '')
    .replace(/remote|united states of america|united states|u\.s\.a?\.?|\busa?\b|anywhere|nationwide|work from home|virtual|n\/a|\d+ locations?/gi, ' ')
    .replace(/[()\-–—,;|/:]+/g, ' ').replace(/\b(in|or|and|office|based|location|within|the)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

const mentionsHome = (s, p) => new RegExp(`\\b(${p.homeState}|${p.homeStateAbbr})\\b`).test(s);

export function classifyRemote({ location, workplaceType, text }, profile, company = {}) {
  if (company.region === 'Caribbean') {
    return { ok: true, level: 'barbados', note: `Based in the Caribbean${location ? ' (' + String(location).trim() + ')' : ''}. Not a remote role.` };
  }
  const loc = String(location || '');
  const wt = String(workplaceType || '').toLowerCase();
  const locRemote = /remote|work from home|virtual|telecommut/i.test(loc) || wt === 'remote';
  if (!locRemote) {
    // Field and site work is welcome in two places: Central America and South Florida.
    const hit = (list) => (list || []).find((x) => new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(loc));
    if (hit(profile.barbadosPlaces)) return { ok: true, level: 'barbados', note: `Based in ${loc.trim()}. Not a remote role.` };
    const abroad = !/,\s*[A-Z]{2}\b/.test(loc) && hit(profile.fieldRegions); // skips Panama City, FL
    if (abroad) return { ok: true, level: 'abroad', note: `Based in ${loc.trim()}. Not a remote role.` };
    if (hit(profile.localPlaces)) return { ok: true, level: 'local', note: `On site or hybrid in South Florida (${loc.trim()}).` };
  }
  if (/hybrid|on-?site/.test(wt)) return { ok: false, why: 'hybrid or on-site' };
  if (!locRemote && /hybrid|on-?site|in[- ]office/i.test(loc)) return { ok: false, why: 'hybrid or on-site' };
  if (!locRemote && !REMOTE_SIGNAL.test(text || '')) return { ok: false, why: 'not remote' };

  let level = 'full';
  const notes = [];
  const left = leftoverLocation(loc);
  if (left) {
    notes.push(`Listed location: ${loc.trim()}.`);
    if (!mentionsHome(loc, profile)) level = 'preferred';
  }
  const all = sentences(text);
  const hard = all.find((s) => RESTRICT.test(s));
  const soft = all.find((s) => PREFER.test(s) && s !== hard);
  if (hard) { if (!mentionsHome(hard, profile)) level = 'restricted'; notes.push(clip(hard)); }
  if (soft) { if (level === 'full') level = 'preferred'; notes.push(clip(soft)); }
  return { ok: true, level, note: notes.join(' ') };
}

// ---------- Application deadline ----------
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';
const DUE_CUE = /(application deadline|applications? (close[sd]?|due|accepted (through|until)|will be accepted (through|until)|must be (received|submitted) by)|closing date|deadline to apply|apply by|open until|closes on|posting (closes|end date)|review of applications (begins|will begin))[^\n]{0,45}/gi;

export function parseDeadline(text, now = new Date()) {
  const t = String(text || '');
  if (/open until filled|until (the position is )?filled|rolling basis/i.test(t)) var note = 'Open until filled';
  for (const m of t.matchAll(DUE_CUE)) {
    const tail = m[0];
    let d = null, x;
    if ((x = tail.match(new RegExp(`(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i')))) d = mk(x[3], monthNum(x[1]), x[2], now);
    else if ((x = tail.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?(?:,?\\s+(\\d{4}))?`, 'i')))) d = mk(x[3], monthNum(x[2]), x[1], now);
    else if ((x = tail.match(/(\d{4})-(\d{2})-(\d{2})/))) d = mk(x[1], Number(x[2]), x[3], now);
    else if ((x = tail.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) d = mk(x[3].length === 2 ? '20' + x[3] : x[3], Number(x[1]), x[2], now);
    if (d) return { closes: d, closesNote: null };
  }
  return { closes: null, closesNote: note || null };
}
const monthNum = (name) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(name.slice(0, 3).toLowerCase()) + 1;
function mk(year, month, day, now) {
  let y = Number(year);
  if (!y) { // no year given: take the next time that date comes around
    y = now.getUTCFullYear();
    if (new Date(Date.UTC(y, month - 1, Number(day))) < new Date(now.getTime() - 60 * 864e5)) y += 1;
  }
  const d = new Date(Date.UTC(y, month - 1, Number(day)));
  return isNaN(d) || month < 1 ? null : d.toISOString().slice(0, 10);
}

// ---------- Relevance ----------
const TITLE_POINTS = [
  [/wildlife|biolog|ecolog|species|avian|habitat|ornitholog/i, 5],
  [/environment/i, 4],
  [/permitting|\bnepa\b|siting|regulatory|natural resource/i, 4],
  [/\bgis\b|geospatial/i, 3],
  [/restoration|monitor|\bfield\b/i, 3],
  [/compliance|conservation|scien(ce|tist)|policy|wetland|stewardship/i, 2],
];
const TITLE_EXCLUDE = /data scien|software|develop(er|ment) (officer|director|manager|associate)|account(ant|ing|s)|financ|sales|recruit|attorney|counsel|\bintern\b|internship|technician|seasonal|electric|mechanic|superintendent|marketing|payroll|interconnection|health (and|&) safety|\behs\b|\bhse\b|communications|fundrais|giving|donor|educat|naturalist|\bcamp\b|facilit|groundskeep|maintenance|custodian|\bcook\b|cafe|visitor|membership|retail|store|right of way|land agent|\bit\b|security|human resources|\bhr\b|grant/i;

const FIT_TERMS = [
  ['endangered species and ESA', /endangered species|\bESA\b|section 7\b|listed species|threatened and endangered/i],
  ['NEPA', /\bNEPA\b|national environmental policy act/i],
  ['wildlife', /wildlife|avian|\bbirds?\b|\bbats?\b|eagle/i],
  ['wetlands and Section 404', /wetland|section 404|clean water act|army corps|\bUSACE\b/i],
  ['agency consultation', /fish and wildlife service|\bUSFWS\b|agency (consultation|coordination|engagement)|regulatory agenc/i],
  ['GIS', /\bGIS\b|ArcGIS|geospatial/i],
  ['solar', /\bsolar\b|photovoltaic|\bPV\b/i],
  ['transmission', /transmission/i],
  ['permitting', /permitting|permits?\b/i],
  ['sea turtles and shorebirds', /sea turtle|shorebird/i],
  ['field work', /field ?work|field (surveys?|monitoring|season|studies|data|sites?)|in the field/i],
  ['habitat restoration', /restoration|restor(e|ing) (rivers?|streams?|wetlands?|habitat)/i],
  ['species monitoring', /monitor(ing)? [^.\n]{0,40}(species|wildlife|birds?|turtles?|nest)|(species|wildlife|nest(ing)?|biological) monitoring/i],
  ['Spanish', /\bspanish\b/i],
];

export function relevance(title, text) {
  if (TITLE_EXCLUDE.test(title)) return { ok: false, score: 0, fit: [] };
  if (/engineer/i.test(title) && !/environment/i.test(title)) return { ok: false, score: 0, fit: [] };
  const titleScore = TITLE_POINTS.reduce((n, [re, pts]) => n + (re.test(title) ? pts : 0), 0);
  const fit = FIT_TERMS.filter(([, re]) => re.test(text || '') || re.test(title)).map(([label]) => label);
  const ok = titleScore >= 5 || (titleScore >= 2 && (fit.length >= 2 || !text));
  return { ok, titleScore, score: titleScore + Math.min(fit.length, 8), fit };
}

// Barbados roles have their own, lower pay floor.
export const payFloor = (remote, profile) => (remote.level === 'barbados' ? profile.minBaseBarbados || profile.minBase : profile.minBase);

// ---------- Concerns ----------
export function findConcerns({ title, text, pay, employment, posted, remote }, company, profile, now) {
  const out = [];
  const floor = payFloor(remote, profile);
  let asksRenew = 0, asksTotal = 0;
  for (const s of sentences(text)) {
    for (const m of s.matchAll(/(\d{1,2})\s*\+?\s*(?:or more\s+)?(?:-\s*\d{1,2}\s*)?years?/gi)) {
      const n = Number(m[1]);
      if (n > 30) continue;
      if (/renewable|solar|wind|utility-scale|energy (project )?development|storage/i.test(s)) asksRenew = Math.max(asksRenew, n);
      else if (/experience/i.test(s)) asksTotal = Math.max(asksTotal, n);
    }
  }
  if (asksRenew > profile.renewableYears) out.push(`Asks for ${asksRenew}+ years in renewable energy, more than you have in that sector.`);
  if (asksTotal > profile.totalYears) out.push(`Asks for ${asksTotal}+ years of experience.`);

  if (!pay) out.push('Pay not listed.');
  else if (pay.unit === 'year' && pay.max < floor) out.push(`Top of the range is under your ${money(floor)} floor.`);
  else if (pay.unit === 'year' && pay.min < floor) out.push(`Low end of the range is under your ${money(floor)} floor.`);
  if (employment === 'contract') {
    if (pay && pay.unit === 'hour' && pay.max < profile.contractMinHourly) out.push(`Contract rate is under your ${money(profile.contractMinHourly)} an hour floor.`);
    else if (!pay || pay.unit !== 'hour') out.push(`Contract role. You need about ${money(profile.contractMinHourly)} an hour or more to cover benefits and taxes.`);
  }

  if (remote.level === 'restricted') out.push('Remote with a location requirement. Check that Florida qualifies.');
  if (remote.level === 'preferred') out.push('Remote, but a location is listed or preferred.');
  if (remote.level === 'barbados') out.push('Based in Barbados or the Caribbean, not remote. Check work permit rules.');
  if (remote.level === 'local') out.push('On site or hybrid in South Florida, not remote.');
  if (remote.level === 'abroad') out.push('Based in Central America. Check pay, work authorization, and whether it is a local-hire role.');
  const travel = [...String(text || '').matchAll(/(\d{1,2})\s*%[^.\n]{0,40}travel|travel[^.\n]{0,60}?(\d{1,2})\s*%/gi)]
    .map((m) => Number(m[1] || m[2])).sort((a, b) => b - a)[0];
  if (travel && travel > profile.maxTravelPercent) out.push(`Travel up to ${travel}%, more than a few trips a year.`);

  if (/permitting/i.test(title)) out.push('Permitting is the core of the job.');
  if (/\b(director|vice president|vp|principal|head of)\b/i.test(title)) out.push('Senior title. May expect people management.');
  if (/(professional engineer|\bP\.?E\.? license|\bPWS\b|\bPMP\b)[^.\n]{0,40}required/i.test(text || '')) out.push('A license or certification is listed as required.');
  if (/oil (and|&) gas|pipeline|natural gas|\bLNG\b|petroleum/i.test(text || '')) out.push('Posting mentions oil, gas, or pipeline work.');
  if (company.focus === 'mixed') out.push('Company or its parent has business outside clean energy. Check against your no fossil fuels rule.');
  if (company.type === 'consulting') out.push('Consulting firm, so expect billable hours and mixed clients.');
  if (company.board) out.push(`Found on ${company.board}, not on the company's own site. Confirm it is still open there.`);
  if (company.board && company.flagged) out.push('The company name suggests oil, gas, coal, or mining. Check it against your no fossil fuels rule.');

  if (posted) {
    const days = Math.floor((now - new Date(posted)) / 864e5);
    if (days > 30) out.push(`Posted ${days} days ago. May be close to filled.`);
  }
  return out;
}

// ---------- One posting in, one row out ----------
export function analyzeJob(raw, company, profile, now = new Date()) {
  const text = (raw.html ? htmlToText(String(raw.html).slice(0, 300000)) : String(raw.text || '')).slice(0, 40000);
  if (!/^https?:\/\//i.test(String(raw.url || ''))) return { skip: 'posting link is not a web address' };
  const rel = relevance(raw.title, text);
  // Job board listings are judged on the job title alone (then location and pay, below).
  // Company-site listings also need the description to back the title up.
  if (!(company.board ? rel.titleScore >= 3 : rel.ok)) return { skip: 'not a match for the role keywords' };
  const remote = classifyRemote({ location: raw.location, workplaceType: raw.workplaceType, text }, profile, company);
  if (!remote.ok) return { skip: remote.why };
  const employment = /\b1099\b|independent contractor|\bcontract\b/i.test(`${raw.title} ${raw.commitment || ''}`) ||
    /\b1099\b|independent contractor/i.test(text) ? 'contract' : 'employee';
  const pay = parseSalary(text, raw.salary);
  // A listed range has to reach the floor. One that tops out below it is dropped. Postings with no pay listed are kept.
  if (pay && pay.unit === 'year' && pay.max < payFloor(remote, profile)) return { skip: 'listed pay never reaches the floor' };
  const posted = raw.posted && !isNaN(new Date(raw.posted)) ? new Date(raw.posted).toISOString().slice(0, 10) : null;
  const due = raw.closes && !isNaN(new Date(raw.closes)) ? { closes: new Date(raw.closes).toISOString().slice(0, 10), closesNote: null } : parseDeadline(text, now);
  if (due.closes && new Date(due.closes) < new Date(now.getTime() - 864e5)) return { skip: 'application deadline has passed' };
  const concerns = findConcerns({ title: raw.title, text, pay, employment, posted, remote }, company, profile, now);
  return {
    job: {
      id: `${company.id}:${raw.id}`, companyId: company.id, title: String(raw.title).trim().slice(0, 200), url: String(raw.url).slice(0, 600),
      posted, closes: due.closes, closesNote: due.closesNote, pay, employment, remote: { level: remote.level, note: remote.note },
      fit: rel.fit, concerns, score: rel.score, verified: true,
      jd: clip(text, 6000),
      ...(company.board ? { source: 'board', board: company.board } : {}),
    },
  };
}
