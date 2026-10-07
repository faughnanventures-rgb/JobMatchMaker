(() => {
  'use strict';

  // ----- storage that still works where the browser blocks it -----
  const store = (() => {
    const mem = {};
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
      return { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) };
    } catch { return { get: (k) => mem[k] ?? null, set: (k, v) => { mem[k] = v; } }; }
  })();
  const KEY = 'jobwatch.marks.v1';
  const STATUS = [['', 'To review'], ['interested', 'Interested'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Not selected'], ['hidden', 'Hidden']];
  const STATUS_NAME = Object.fromEntries(STATUS);
  const APPLIED = new Set(['applied', 'interviewing', 'offer', 'rejected']);
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  // Everything read from storage or a backup file goes through here. Unknown fields are dropped,
  // so a damaged or hostile file cannot inject anything.
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const goodKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 300 && !['__proto__', 'constructor', 'prototype'].includes(k);
  function clean(raw) {
    const m = { jobs: Object.create(null), stars: Object.create(null), blocked: Object.create(null), requests: [], lastVisit: null, base: { resume: '', cover: '' }, code: '', installSeen: false, showBoards: true, manual: Object.create(null) };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return m;
    const each = (o, fn) => { if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o).slice(0, 5000)) if (goodKey(k)) fn(k, o[k]); };
    each(raw.jobs, (k, v) => {
      if (!v || typeof v !== 'object') return;
      const j = {};
      if (Object.hasOwn(STATUS_NAME, v.status)) j.status = v.status;
      if (DATE.test(v.date || '')) j.date = v.date;
      if (text(v.notes, 5000)) j.notes = text(v.notes, 5000);
      if (text(v.resumeId, 60)) j.resumeId = text(v.resumeId, 60);
      if (text(v.coverId, 60)) j.coverId = text(v.coverId, 60);
      if (Array.isArray(v.log)) j.log = v.log.filter((x) => x && DATE.test(x.d || '') && Object.hasOwn(STATUS_NAME, x.s)).slice(-50).map((x) => ({ d: x.d, s: x.s }));
      m.jobs[k] = j;
    });
    each(raw.stars, (k, v) => { if (v) m.stars[k] = true; });
    each(raw.blocked, (k, v) => { if (v) m.blocked[k] = true; });
    each(raw.manual, (k, v) => { if (DATE.test(v || '')) m.manual[k] = v; });
    if (Array.isArray(raw.requests)) m.requests = raw.requests.slice(0, 100).filter((r) => r && text(r.name, 120)).map((r) => ({ name: text(r.name, 120), url: text(r.url, 300) }));
    if (raw.base && typeof raw.base === 'object') m.base = { resume: text(raw.base.resume, 30000), cover: text(raw.base.cover, 30000) };
    m.code = text(raw.code, 200);
    m.installSeen = raw.installSeen === true;
    m.showBoards = raw.showBoards !== false;
    m.lastVisit = text(raw.lastVisit, 40) || null;
    return m;
  }
  let marks = clean(null);
  try { marks = clean(JSON.parse(store.get(KEY) || 'null')); } catch { /* start fresh */ }
  const save = () => { try { store.set(KEY, JSON.stringify(marks)); } catch { /* storage full or blocked */ } };
  const prevVisit = marks.lastVisit;
  marks.lastVisit = new Date().toISOString(); save();

  const $ = (id) => document.getElementById(id);
  // A running log for the problem report, since phones have no error console.
  const diag = [];
  const note = (t) => { diag.push(`${new Date().toISOString().slice(11, 19)} ${String(t).slice(0, 300)}`); if (diag.length > 60) diag.shift(); };
  window.addEventListener('error', (e) => note(`Script error: ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`));
  window.addEventListener('unhandledrejection', (e) => note(`Unhandled: ${(e.reason && e.reason.message) || e.reason}`));
  const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#'; } catch { return '#'; } };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fmtDate = (d, opts) => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' }); };
  const noon = (d) => new Date(d + 'T12:00:00');
  const today = () => new Date().toISOString().slice(0, 10);
  const say = (msg) => { $('live').textContent = ''; setTimeout(() => { $('live').textContent = msg; }, 60); };
  const TYPE = { renewable: 'Renewable energy', conservation: 'Conservation and research', consulting: 'Consulting', other: 'Other' };
  const LEVEL = { full: 'Fully remote', preferred: 'Remote, location preferred', restricted: 'Remote, location required', local: 'South Florida, on site or hybrid', abroad: 'Central America, on site', barbados: 'Barbados or Caribbean, on site', onsite: 'On site' };
  const typeName = (c) => (c.region === 'Caribbean' ? 'Barbados and Caribbean' : TYPE[c.type] || '');

  let data = { jobs: [], companies: [], health: [] };
  let co = new Map();
  let view = 'jobs', tab = 'review', opener = null;

  // ----- documents live in this browser's own database -----
  let docs = [];
  const idb = (() => {
    let dbp;
    const open = () => (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open('jobwatch', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('docs', mode); const q = fn(t.objectStore('docs')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return { all: () => tx('readonly', (o) => o.getAll()), put: (d) => tx('readwrite', (o) => o.put(d)), del: (id) => tx('readwrite', (o) => o.delete(id)) };
  })();
  const addDoc = async (d) => { docs.push(d); try { await idb.put(d); } catch { say('This browser would not save the file. It will be gone when you close the page.'); } };
  const docOptions = (kind, sel) => '<option value="">Not set</option>' + docs.filter((d) => d.kind === kind).map((d) => `<option value="${esc(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.label)}</option>`).join('');

  const mark = (id) => marks.jobs[id] || {};
  const setMark = (id, patch) => { if (!goodKey(id)) return; marks.jobs[id] = { ...mark(id), ...patch }; save(); };
  const statusOf = (j) => mark(j.id).status || '';
  const isNew = (j) => !prevVisit || (j.firstSeen && j.firstSeen > prevVisit.slice(0, 10));
  const annual = (p) => (p ? (p.unit === 'hour' ? num(p.max) * 1880 : num(p.max)) : 0);
  const when = (j) => String(j.posted || j.firstSeen || '');

  function tabOf(j) {
    const s = statusOf(j);
    if (APPLIED.has(s)) return 'applied';
    if (j.closed) return s === 'interested' ? 'closed' : null;
    if (marks.blocked[j.companyId]) return null;
    if (s === 'hidden') return 'hidden';
    if (s === 'interested') return 'interested';
    return 'review';
  }

  function passes(j) {
    const c = co.get(j.companyId) || {};
    const t = $('fType').value, r = $('fRemote').value, e = $('fEmp').value, min = num($('fMin').value);
    if (t && c.type !== t) return false;
    if (r && j.remote?.level !== r) return false;
    if (e && j.employment !== e) return false;
    if ($('fPay').checked && !j.pay) return false;
    if (min && j.pay && annual(j.pay) < min) return false;
    if ($('fStar').checked && !marks.stars[j.companyId]) return false;
    if (!$('fBoards').checked && j.source === 'board') return false;
    return true;
  }

  function sorter() {
    const byNew = (a, b) => when(b).localeCompare(when(a)) || annual(b.pay) - annual(a.pay);
    const s = $('fSort').value;
    if (s === 'pay') return (a, b) => annual(b.pay) - annual(a.pay) || byNew(a, b);
    if (s === 'due') return (a, b) => String(a.closes || '9999').localeCompare(String(b.closes || '9999')) || byNew(a, b);
    if (s === 'star') return (a, b) => (marks.stars[b.companyId] ? 1 : 0) - (marks.stars[a.companyId] ? 1 : 0) || byNew(a, b);
    return byNew;
  }

  function ageHtml(j) {
    const since = (d) => Math.max(0, Math.floor((Date.now() - noon(d)) / 864e5));
    const plural = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
    let out;
    if (DATE.test(j.posted || '')) {
      const days = since(j.posted);
      out = `<span class="age ${days > 30 ? 'stale' : ''}">${days === 0 ? 'Posted today' : 'Open ' + plural(days)}</span> <span class="sub">Posted ${esc(fmtDate(noon(j.posted)))}</span>`;
    } else if (DATE.test(j.firstSeen || '')) {
      out = `<span class="age">${since(j.firstSeen) === 0 ? 'First seen today' : 'Open at least ' + plural(since(j.firstSeen))}</span> <span class="sub">No post date listed</span>`;
    } else out = '<span class="age">Date not listed</span>';
    if (DATE.test(j.closes || '')) {
      const left = Math.ceil((noon(j.closes) - Date.now()) / 864e5);
      out += left < 0 ? ` <span class="due soon">Deadline passed ${esc(fmtDate(noon(j.closes)))}</span>`
        : ` <span class="due ${left <= 7 ? 'soon' : ''}">Apply by ${esc(fmtDate(noon(j.closes)))}${left <= 14 ? ', ' + (left === 0 ? 'today' : plural(left) + ' left') : ''}</span>`;
    } else out += ` <span class="due sub">${j.closesNote ? esc(j.closesNote) : 'No deadline listed'}</span>`;
    return out;
  }

  function payHtml(j) {
    if (!j.pay) return '<span class="sub">Not listed</span>';
    let extra = '';
    if (j.pay.unit === 'hour') {
      const floor = num(data.profile?.contractMinHourly) || 55;
      extra = `<span class="sub">${num(j.pay.max) >= floor ? 'Meets' : 'Under'} the $${floor} an hour contract floor</span>`;
    }
    return esc(j.pay.text) + extra;
  }

  function rowHtml(j, i) {
    const c = co.get(j.companyId) || { id: j.companyId, name: j.companyId };
    const m = mark(j.id), s = statusOf(j), starred = !!marks.stars[j.companyId], fresh = isNew(j) && !j.closed;
    const opts = STATUS.map(([v, l]) => `<option value="${v}" ${v === s ? 'selected' : ''}>${l}</option>`).join('');
    const level = Object.hasOwn(LEVEL, j.remote?.level) ? j.remote.level : 'full';
    const board = j.source === 'board';
    return `<article class="row ${fresh ? 'is-new' : ''} ${board ? 'from-board' : ''}" data-id="${esc(j.id)}" aria-labelledby="jt${i}">
      <div class="c-posted"><span class="lab">Open and deadline: </span>${ageHtml(j)}${fresh ? ' <span class="newtag">New</span>' : ''}</div>
      <div class="c-company"><span class="lab">Company: </span>
        <button type="button" class="star" data-action="star" data-co="${esc(c.id)}" aria-pressed="${starred}" aria-label="Star ${esc(c.name)}"><span aria-hidden="true">${starred ? '★' : '☆'}</span></button>
        <span><button type="button" class="linklike" data-action="company" data-co="${esc(c.id)}" aria-haspopup="dialog">${esc(c.name)}<span class="sr">, about this company</span></button><span class="sub">${esc(c.board ? 'Not on the watched list' : typeName(c))}</span></span>
      </div>
      <div class="c-job"><h3 id="jt${i}"><a href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${esc(j.title)}<span class="sr"> (opens the posting in a new tab)</span></a></h3>
        ${board ? `<span class="tag board">From a job board: ${esc(j.board || 'job board')}</span> ` : ''}
        ${j.employment === 'contract' ? '<span class="tag">Contract</span> ' : ''}
        ${j.closed ? `<span class="tag caution">Posting closed ${esc(fmtDate(noon(j.closedAt || j.lastSeen)))}</span> ` : ''}
        ${j.verified === false ? '<span class="tag caution">Not confirmed on the company site</span>' : ''}</div>
      <div class="c-pay"><span class="lab show">Pay</span>${payHtml(j)}</div>
      <div class="c-remote"><span class="lab show">Where</span><span class="lvl lvl-${level}">${esc(LEVEL[level])}</span>${j.remote?.note ? `<p class="note">${esc(j.remote.note)}</p>` : ''}</div>
      <div class="c-fit"><span class="lab show">Why it fits</span>${Array.isArray(j.fit) && j.fit.length ? 'Matches ' + esc(j.fit.join(', ')) : '<span class="sub">Title match only</span>'}</div>
      <div class="c-concerns"><span class="lab show">Concerns</span>${Array.isArray(j.concerns) && j.concerns.length ? '<ul>' + j.concerns.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<span class="sub">None spotted</span>'}</div>
      <div class="c-actions">
        <select data-action="status" aria-label="Status for ${esc(j.title)} at ${esc(c.name)}">${opts}</select>
        ${s === 'hidden' ? `<button type="button" class="btn quiet" data-action="unhide">Show again<span class="sr">: ${esc(j.title)}</span></button>` : `<button type="button" class="btn quiet" data-action="hide">Hide<span class="sr">: ${esc(j.title)}</span></button>`}
        ${j.closed ? '' : `<button type="button" class="btn quiet" data-action="tailor" aria-haspopup="dialog">Draft tailored versions<span class="sr"> for ${esc(j.title)}</span></button>`}
        <details ${APPLIED.has(s) || m.notes ? 'open' : ''}><summary>Track this application${m.date ? ', applied ' + esc(fmtDate(noon(m.date))) : ''}<span class="sr">: ${esc(j.title)}</span></summary>
          <label>Applied on <input type="date" data-action="date" value="${esc(m.date || '')}"></label>
          <label>Resume used <select data-action="resumeId">${docOptions('resume', m.resumeId)}</select></label>
          <label>Cover letter used <select data-action="coverId">${docOptions('cover', m.coverId)}</select></label>
          <label>Notes <textarea data-action="notes" maxlength="5000">${esc(m.notes || '')}</textarea></label>
          ${m.log?.length ? '<ul class="log" aria-label="Status history">' + m.log.map((x) => `<li>${esc(fmtDate(noon(x.d)))}: ${esc(STATUS_NAME[x.s] || 'To review')}</li>`).join('') + '</ul>' : ''}
        </details>
      </div>
    </article>`;
  }

  const EMPTY = {
    review: 'Nothing new to review. The check runs every day at 11 in the morning, Eastern time.',
    interested: 'No jobs marked interested yet. Set a job\'s status to Interested to keep it here.',
    applied: 'No applications tracked yet. Set a job\'s status to Applied after you send one, then pick the resume and cover letter you used.',
    hidden: 'No hidden jobs. Use Hide on any job you don\'t want to see again.',
    closed: 'None of the jobs you saved have closed.',
  };
  const TABS = [['review', 'To review'], ['interested', 'Interested'], ['applied', 'Applications'], ['hidden', 'Hidden'], ['closed', 'Closed']];
  let shownCount = 0;

  function renderJobs() {
    const counts = { review: 0, interested: 0, applied: 0, hidden: 0, closed: 0 };
    const shown = [];
    for (const j of data.jobs) { const t = tabOf(j); if (!t) continue; counts[t]++; if (t === tab && passes(j)) shown.push(j); }
    $('tabs').innerHTML = TABS.map(([k, l]) => `<button type="button" data-action="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}<span class="n">${counts[k]}<span class="sr"> ${counts[k] === 1 ? 'job' : 'jobs'}</span></span></button>`).join('');
    shown.sort(sorter());
    shownCount = shown.length;
    $('rows').innerHTML = shown.length ? shown.map(rowHtml).join('')
      : `<p class="empty">${counts[tab] ? 'No jobs match these filters. Clear a filter to see more.' : EMPTY[tab]}</p>`;
  }

  function renderSummary() {
    const open = data.jobs.filter((j) => tabOf(j) === 'review');
    const fresh = open.filter(isNew).length;
    const failed = (data.health || []).filter((h) => h && h.ok === false).length;
    const d = new Date(data.generatedAt);
    const whenTxt = isNaN(d) ? '' : `Checked ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}. `;
    $('summary').innerHTML = `${esc(whenTxt)}<strong>${open.length} to review</strong>${prevVisit ? `, ${fresh} new since your last visit` : ''}.` +
      (failed ? ` ${failed} company ${failed === 1 ? 'site' : 'sites'} could not be read. <button type="button" class="linklike" data-action="goManual">See the sites to check yourself</button>` : '');
    $('notice').innerHTML = data.sample ? '<p class="notice">These rows come from a manual test, not a live check. They are replaced the first time the scheduled check runs.</p>' : '';
  }

  function renderCompanies() {
    const health = new Map((data.health || []).filter(Boolean).map((h) => [h.companyId, h]));
    const openBy = {};
    for (const j of data.jobs) if (!j.closed) openBy[j.companyId] = (openBy[j.companyId] || 0) + 1;
    const list = data.companies.filter((c) => !c.board).sort((a, b) => (marks.stars[b.id] ? 1 : 0) - (marks.stars[a.id] ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    $('coRows').innerHTML = list.map((c) => {
      const h = health.get(c.id), starred = !!marks.stars[c.id], blocked = !!marks.blocked[c.id];
      const check = !h ? '<span class="sub">Not checked yet</span>' : h.skipped ? `<span class="sub">Paused. ${esc(h.note || '')}</span>`
        : h.ok ? `<span class="sub">Read ${num(h.postings)} postings</span>` : `<span class="bad">Could not read. ${esc(h.error || '')}</span> <button type="button" class="btn quiet" data-action="fixLink" data-co="${esc(c.id)}">Fix link<span class="sr"> for ${esc(c.name)}</span></button>`;
      const n = num(openBy[c.id]);
      return `<div class="co-row ${blocked ? 'blocked' : ''}">
        <button type="button" class="star" data-action="star" data-co="${esc(c.id)}" aria-pressed="${starred}" aria-label="Star ${esc(c.name)}"><span aria-hidden="true">${starred ? '★' : '☆'}</span></button>
        <div><button type="button" class="linklike" data-action="company" data-co="${esc(c.id)}" aria-haspopup="dialog">${esc(c.name)}<span class="sr">, about this company</span></button>${blocked ? ' <span class="tag caution">Blocked</span>' : ''}</div>
        <div class="sub">${esc(typeName(c))}</div>
        <div>${n} open ${n === 1 ? 'match' : 'matches'}</div>
        <div>${check}</div>
        <div><button type="button" class="btn quiet" data-action="block" data-co="${esc(c.id)}" aria-pressed="${blocked}">Block<span class="sr"> ${esc(c.name)}</span></button></div>
      </div>`;
    }).join('');
    $('reqList').innerHTML = marks.requests.map((r, i) => `<li>${esc(r.name)}${r.url ? ' (' + esc(r.url) + ')' : ''} <button type="button" class="btn quiet" data-action="delReq" data-i="${i}">Remove<span class="sr"> ${esc(r.name)}</span></button></li>`).join('');
    const tried = (data.health || []).filter((h) => h && !h.skipped);
    const bad = tried.filter((h) => !h.ok);
    $('health').innerHTML = tried.length
      ? `<p class="lede">Read ${tried.length - bad.length} of ${tried.length} company sites on the last check.${bad.length ? ' A site that could not be read is not the same as no jobs. Whoever maintains this site can fix the link.' : ''}</p>` +
        ''
      : '<p class="lede">No check has run yet.</p>';
    const boards = Array.isArray(data.boards) ? data.boards.filter((b) => b && typeof b.name === 'string') : [];
    const why = (b) => { const d = b.dropped && typeof b.dropped === 'object' ? Object.entries(b.dropped).filter(([, n]) => num(n) > 0).sort((x, y) => num(y[1]) - num(x[1])).slice(0, 4) : []; return d.length ? ' Dropped: ' + d.map(([k, n]) => `${num(n)} ${text(k, 60)}`).join(', ') + '.' : ''; };
    const boardLine = (b) => `${b.name}: ` + (b.off ? b.off : b.ok ? `read ${num(b.postings)} listings and kept ${num(b.matched)}.${why(b)}` : `could not be read. ${b.error || ''}`);
    if (boards.length) $('health').innerHTML += '<p class="lede">Job boards</p><ul class="reqlist">' + boards.map((b) => `<li>${esc(boardLine(b))}</li>`).join('') + '</ul>';
    const lines = [...bad.map((h) => { const c = co.get(h.companyId) || {}; return `${c.name || h.companyId} | ${c.careers || ''} | ${h.error || ''}`; }), ...boards.map((b) => 'Job board | ' + boardLine(b))];
    if (lines.length) $('health').innerHTML += `<label for="badList">Everything above as one list, to copy and send</label><textarea id="badList" class="badlist" readonly rows="6">${esc(lines.join('\n'))}</textarea><p><button type="button" class="btn" data-action="copyHealth">Copy this list</button></p>`;
    // sites to open by hand, oldest check first
    const mine = bad.filter((h) => co.has(h.companyId) && !marks.blocked[h.companyId]).sort((x, y) => String(marks.manual[x.companyId] || '').localeCompare(String(marks.manual[y.companyId] || '')) || String(co.get(x.companyId).name).localeCompare(String(co.get(y.companyId).name)));
    $('manualList').innerHTML = mine.length ? mine.map((h) => {
      const c = co.get(h.companyId), dead = /not found/i.test(h.error || '');
      let link = safeUrl(c.careers); if (dead) { try { link = new URL('/', c.careers).href; } catch { /* keep */ } }
      const last = marks.manual[c.id];
      return `<li><span><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}<span class="sr"> (opens ${dead ? 'their home page' : 'their careers page'} in a new tab)</span></a><span class="sub">${dead ? 'The careers link is out of date, so this opens their home page. ' : ''}${last ? 'You last checked ' + esc(fmtDate(noon(last))) + '.' : 'Not checked yet.'}</span></span>
        <button type="button" class="btn quiet" data-action="manualDone" data-co="${esc(c.id)}">I checked this<span class="sr">: ${esc(c.name)}</span></button></li>`;
    }).join('') : '<li><span>Every company site was read on the last check. Nothing to do by hand.</span></li>';
  }

  function renderDocs() {
    if (document.activeElement !== $('baseResume')) $('baseResume').value = marks.base.resume || '';
    if (document.activeElement !== $('baseCover')) $('baseCover').value = marks.base.cover || '';
    const used = {};
    for (const m of Object.values(marks.jobs)) for (const k of [m.resumeId, m.coverId]) if (k) used[k] = (used[k] || 0) + 1;
    $('docRows').innerHTML = docs.length ? [...docs].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))).map((d) => `<div class="doc-row">
        <div><strong>${esc(d.label)}</strong><span class="sub">${esc(d.fileName || 'Text draft')}</span></div>
        <div>${d.kind === 'cover' ? 'Cover letter' : 'Resume'}</div>
        <div class="sub">Added ${esc(fmtDate(d.addedAt))}</div>
        <div>Used for ${num(used[d.id])} ${used[d.id] === 1 ? 'job' : 'jobs'}</div>
        <div><button type="button" class="btn quiet" data-action="getDoc" data-doc="${esc(d.id)}">Download<span class="sr"> ${esc(d.label)}</span></button> <button type="button" class="btn quiet" data-action="delDoc" data-doc="${esc(d.id)}">Delete<span class="sr"> ${esc(d.label)}</span></button></div>
      </div>`).join('') : '<p class="empty">No versions saved yet. Add the resume and cover letter files you send out.</p>';
  }

  function openDialog(id, from) { if (from) opener = from; const d = $(id); if (!d.open) d.showModal(); }

  // ----- this site's own functions: run a check, test a link, save a company -----
  let runTimer = null;
  async function api(path, body) {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) || {};
      if (!(body && body.action === 'status' && res.status === 200)) note(`${path}${body && body.action ? ' ' + body.action : ''} answered ${res.status}${out.error ? ': ' + out.error : ''}${out.message ? ': ' + out.message : ''}`);
      return { status: res.status, data: out };
    } catch (e) { note(`${path} could not be reached: ${e && e.message}`); return { status: -1, data: {} }; }
  }
  const apiProblem = (r, what) => (r.status === 429 ? (text(r.data.error, 200) || 'Too many tries. Wait a few minutes.')
    : [404, 405, 503].includes(r.status) ? `${what} is not switched on yet. Whoever maintains this site needs to finish the setup.` : 'That did not work. Try again in a minute.');
  function setRun(pct, msg, busy) {
    $('runBar').hidden = pct === null; if (pct !== null) $('runProg').value = pct;
    $('runMsg').textContent = msg; $('runBtn').disabled = !!busy;
  }
  async function startRun() {
    setRun(3, 'Asking for a new check.', true);
    const r = await api('/api/run', { action: 'start' });
    if (r.status === 200) return trackRun(Date.now());
    setRun(null, apiProblem(r, 'Running a check from here'), false);
  }
  function trackRun(since) {
    const before = data.generatedAt; let tries = 0;
    const stop = (msg, pct = null) => { clearInterval(runTimer); runTimer = null; setRun(pct, msg, false); say(msg); };
    const tick = async () => {
      tries++;
      const r = await api('/api/run', { action: 'status' });
      const run = r.data && r.data.run;
      if (r.status !== 200 || !run) { if (tries > 5) stop('The check status could not be read. Reload the page in a few minutes.'); return; }
      if (new Date(run.startedAt).getTime() < since - 90000) { setRun(5, 'Waiting for the check to start.', true); if (tries > 20) stop('The check did not start. Try again.'); return; }
      if (run.status !== 'completed') { setRun(run.total ? 10 + Math.round(70 * num(run.done) / num(run.total)) : 8, run.step ? `Checking. Current step: ${text(run.step, 80)}.` : 'The check is waiting in line.', true); return; }
      if (run.conclusion !== 'success') return stop('The check ran into a problem. The last good list is still shown.');
      setRun(88, 'Check finished. Publishing the new list.', true);
      try {
        const d = await (await fetch('data/jobs.json', { cache: 'no-store', credentials: 'omit' })).json();
        if (d && d.generatedAt && d.generatedAt !== before) { useData(d); return stop(`Updated. ${data.jobs.filter((j) => tabOf(j) === 'review').length} to review.`, 100); }
      } catch { /* not published yet */ }
      if (tries > 80) stop('The check finished. Reload the page in a minute to see the new list.');
    };
    clearInterval(runTimer); runTimer = setInterval(tick, 7000); tick();
  }
  async function linkAction(a) {
    const name = $('vName').value.trim(), url = $('vUrl').value.trim(), msg = (t) => { $('vMsg').textContent = t; };
    if (!name) { $('vName').focus(); return msg('Type the company name first.'); }
    if (!/^https:\/\/\S+\.\S+/i.test(url)) { $('vUrl').focus(); return msg('Paste the full link, starting with https://'); }
    if (a === 'checkLink') {
      msg('Checking the link. This can take up to a minute.'); $('vSave').disabled = true;
      const r = await api('/api/verify', { url });
      if (r.status !== 200) return msg(apiProblem(r, 'Checking links'));
      if (r.data.ok) {
        $('vSave').disabled = false; $('vSave').dataset.url = url;
        const n = num(r.data.postings), ex = Array.isArray(r.data.samples) ? r.data.samples.filter((x) => typeof x === 'string').slice(0, 3) : [];
        msg(n ? `This link works. The check read ${n} ${n === 1 ? 'posting' : 'postings'}${ex.length ? ', for example ' + ex.join('; ') : ''}. You can save it now.` : 'This link works, but no matching postings are listed there right now. You can still save it.');
      } else msg(`This link cannot be read. ${text(r.data.message, 200)} Try opening the careers page, tapping any job, and copying that address.`);
    } else {
      if ($('vSave').dataset.url !== url) return msg('Check the link first.');
      msg('Saving.');
      const r = await api('/api/company', { id: $('vId').value, name, careers: url, type: $('vType').value });
      if (r.status !== 200) return msg(text(r.data.error, 200) || apiProblem(r, 'Saving a company'));
      const done = `${r.data.added ? 'Added' : 'Updated'} ${text(r.data.name, 120)}.`;
      $('vId').value = $('vName').value = $('vUrl').value = ''; $('vSave').disabled = true;
      msg(`${done} Starting a check.`);
      const go = await api('/api/run', { action: 'start' });
      if (go.status === 200) { msg(`${done} A check is running now and takes a few minutes.`); trackRun(Date.now()); }
      else msg(`${done} It will be included in the next check.`);
    }
  }

  function openCompany(id, from) {
    const c = co.get(id); if (!c) return;
    const starred = !!marks.stars[id], blocked = !!marks.blocked[id];
    const facts = [c.board ? 'Found on ' + c.board : typeName(c), c.hq ? 'Based in ' + c.hq : '', c.size].filter(Boolean).join('. ');
    $('coDialog').innerHTML = `<h2 id="coName" tabindex="-1">${esc(c.name)}</h2>
      <p class="facts">${esc(facts)}${facts ? '.' : ''}</p>
      ${c.focus === 'mixed' ? '<p><span class="tag caution">Has business outside clean energy</span></p>' : ''}
      <p>${esc(c.about || 'No description on file yet.')}</p>
      <p><a href="${esc(safeUrl(c.careers))}" target="_blank" rel="noopener noreferrer">${c.board ? 'Open the job board listing' : 'See all jobs on their site'}<span class="sr"> (opens in a new tab)</span></a></p>
      <div class="acts">
        <button type="button" class="btn" data-action="star" data-co="${esc(id)}" data-reopen="1" aria-pressed="${starred}">${starred ? 'Remove star' : 'Star this company'}</button>
        <button type="button" class="btn quiet" data-action="block" data-co="${esc(id)}" data-reopen="1" aria-pressed="${blocked}">${blocked ? 'Unblock this company' : 'Never show this company'}</button>
        <button type="button" class="btn quiet" data-action="closeDialog" data-dialog="coDialog">Close</button>
      </div>`;
    openDialog('coDialog', from);
  }

  // ----- add to home screen -----
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; if ($('installDialog').open) openInstall(); });
  function openInstall(from) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const how = installEvent ? '<p>Add this page as an app so it opens from your home screen or dock like any other app.</p>'
      : ios ? '<p>On an iPhone or iPad, open this page in Safari, tap the Share button, then choose Add to Home Screen.</p>'
      : '<p>On a laptop in Chrome or Edge, use the install icon at the right end of the address bar, or open the browser menu and choose Install. In Safari on a Mac, choose File, then Add to Dock.</p><p>On an Android phone, open the browser menu and choose Add to Home screen. On an iPhone, use Safari, tap Share, then Add to Home Screen.</p>';
    $('installDialog').innerHTML = `<h2 id="instTitle" tabindex="-1">Keep this one tap away</h2>${how}
      <div class="acts">${installEvent ? '<button type="button" class="btn" data-action="doInstall">Install</button>' : ''}<button type="button" class="btn quiet" data-action="closeDialog" data-dialog="installDialog">${installEvent ? 'Not now' : 'Got it'}</button></div>`;
    openDialog('installDialog', from);
  }

  // ----- tailored drafts -----
  let tailorJob = null;
  function openTailor(id, state = {}, from) {
    const j = data.jobs.find((x) => x.id === id); if (!j) return;
    const c = co.get(j.companyId) || { name: j.companyId };
    tailorJob = j;
    let body;
    if (!marks.base.resume?.trim()) {
      body = `<p>Add your base resume first. The draft starts from it.</p><div class="acts"><button type="button" class="btn" data-action="view" data-view="docs" data-close="tailorDialog">Go to Documents</button><button type="button" class="btn quiet" data-action="closeDialog" data-dialog="tailorDialog">Close</button></div>`;
    } else if (state.result) {
      const r = state.result;
      const list = (items) => (Array.isArray(items) && items.length ? '<ul>' + items.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="sub">None noted.</p>');
      body = `<p class="lede">A first pass only. Read both closely and fix anything that is not true to your experience before you send them.</p>
        <div class="two"><div><label for="tResume">Tailored resume</label><textarea id="tResume">${esc(r.resume || '')}</textarea></div>
        <div><label for="tCover">Tailored cover letter</label><textarea id="tCover">${esc(r.coverLetter || '')}</textarea></div></div>
        <h3>What changed</h3>${list(r.changes)}<h3>Gaps to be ready for</h3>${list(r.gaps)}
        <div class="acts"><button type="button" class="btn" data-action="saveTailor">Save both as versions for this job</button><button type="button" class="btn quiet" data-action="copyT" data-from="tResume">Copy resume</button><button type="button" class="btn quiet" data-action="copyT" data-from="tCover">Copy cover letter</button><button type="button" class="btn quiet" data-action="closeDialog" data-dialog="tailorDialog">Close</button></div>
        <p class="sub" id="tMsg" role="status"></p>`;
    } else {
      body = `<p class="lede">This sends your base resume, base cover letter, and the job description below to Claude through this site to write a first draft. Nothing is stored on the site.</p>
        <label for="tJd">Job description</label><textarea id="tJd" maxlength="9000" aria-describedby="tJdHint">${esc(j.jd || '')}</textarea>
        <p class="sub" id="tJdHint">${j.jd ? 'Saved from the posting. Edit it if you like.' : 'No description was saved for this job. Open the posting and paste it here for a better draft.'}</p>
        <p><label for="tCode">Access code</label><input id="tCode" type="password" value="${esc(marks.code || '')}" autocomplete="off" maxlength="200" aria-describedby="tErr"></p>
        <p class="bad" id="tErr" role="alert">${esc(state.error || '')}</p>
        <div class="acts"><button type="button" class="btn" data-action="runTailor" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Writing the draft. This can take a minute.' : 'Write first draft'}</button><button type="button" class="btn quiet" data-action="closeDialog" data-dialog="tailorDialog">Close</button></div>`;
    }
    $('tailorDialog').innerHTML = `<h2 id="tailTitle" tabindex="-1">${esc(j.title)}</h2><p class="facts">${esc(c.name)}</p>${body}`;
    openDialog('tailorDialog', from);
  }
  async function runTailor() {
    const j = tailorJob, c = co.get(j.companyId) || {};
    const jd = $('tJd').value.trim(); marks.code = $('tCode').value.trim(); save();
    openTailor(j.id, { busy: true }); $('tJd').value = jd;
    say('Writing the draft. This can take a minute.');
    let error = '';
    try {
      const res = await fetch('/api/tailor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer',
        body: JSON.stringify({ code: marks.code, resume: marks.base.resume, cover: marks.base.cover, job: { title: j.title, company: c.name, about: c.about, jd } }) });
      if (res.ok) {
        const out = await res.json();
        if (tailorJob === j && $('tailorDialog').open) { openTailor(j.id, { result: out }); $('tailTitle').focus(); say('The draft is ready.'); }
        return;
      }
      error = res.status === 401 ? 'That access code was not accepted.'
        : res.status === 429 ? 'Too many wrong codes. Try again in 15 minutes.'
        : res.status === 413 ? 'That is too much text. Shorten the job description and try again.'
        : [403, 404, 405, 503].includes(res.status) ? 'Tailoring is not switched on for this site yet. Whoever maintains it needs to add an API key and an access code.'
        : 'The draft could not be written. Try again in a minute.';
    } catch { error = 'The draft could not be written. Check your connection and try again.'; }
    if (tailorJob === j && $('tailorDialog').open) { openTailor(j.id, { error }); $('tJd').value = jd; }
  }

  function render() {
    $('jobsView').hidden = view !== 'jobs'; $('companiesView').hidden = view !== 'companies'; $('docsView').hidden = view !== 'docs';
    document.querySelectorAll('[data-action="view"][data-view]').forEach((b) => { if (b.closest('nav')) b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
    renderSummary(); if (view === 'jobs') renderJobs(); else if (view === 'companies') renderCompanies(); else renderDocs();
  }

  // Re-drawing replaces the buttons, so put keyboard focus back where it was.
  const q = (s) => (window.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\\]]/g, '\\$&'));
  function pathTo(el) {
    const a = el.dataset.action, row = el.closest('.row');
    if (row && a) return `.row[data-id="${q(row.dataset.id)}"] [data-action="${a}"]`;
    if (el.dataset.co && a) return `${el.closest('dialog') ? 'dialog[open] ' : 'main '}[data-action="${a}"][data-co="${q(el.dataset.co)}"]`;
    if (el.dataset.tab) return `[data-tab="${el.dataset.tab}"]`;
    if (el.dataset.view) return `nav [data-view="${el.dataset.view}"]`;
    return el.id ? '#' + el.id : null;
  }
  function redraw(el, fallback) {
    const path = el ? pathTo(el) : null;
    render();
    const target = (path && document.querySelector(path)) || (fallback && document.querySelector(fallback));
    if (target) target.focus(); else if (el) $('main').focus();
  }

  // ----- actions -----
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || ['SELECT', 'TEXTAREA', 'INPUT'].includes(el.tagName)) return;
    const a = el.dataset.action, id = el.closest('.row')?.dataset.id, cid = el.dataset.co, docId = el.dataset.doc;
    const job = id ? data.jobs.find((x) => x.id === id) : null;
    const cname = cid ? (co.get(cid)?.name || 'this company') : '';
    if (a === 'view') { view = el.dataset.view; if (el.dataset.close) { opener = null; $(el.dataset.close).close(); } redraw(el.dataset.close ? null : el); if (el.dataset.close) $(view === 'docs' ? 'baseResume' : 'main').focus(); }
    else if (a === 'tab') { tab = el.dataset.tab; redraw(el); say(`${shownCount} ${shownCount === 1 ? 'job' : 'jobs'} shown.`); }
    else if (a === 'star' || a === 'block') {
      if (!goodKey(cid)) return;
      const set = a === 'star' ? marks.stars : marks.blocked;
      if (set[cid]) delete set[cid]; else set[cid] = true;
      save();
      if (el.dataset.reopen) { render(); openCompany(cid); document.querySelector(`#coDialog [data-action="${a}"]`)?.focus(); }
      else redraw(el);
      say(a === 'star' ? (set[cid] ? `Starred ${cname}.` : `Removed the star from ${cname}.`) : (set[cid] ? `Blocked ${cname}. Its jobs are no longer shown.` : `Unblocked ${cname}.`));
    }
    else if (a === 'company') openCompany(cid, pathTo(el));
    else if (a === 'runNow') startRun();
    else if (a === 'goManual') { view = 'companies'; render(); $('manualH').focus(); $('manualH').scrollIntoView(); }
    else if (a === 'manualDone') { if (!goodKey(cid)) return; marks.manual[cid] = today(); save(); renderCompanies(); (document.querySelector('#manualList [data-action="manualDone"]') || $('manualH')).focus(); say(`Marked ${cname} as checked today.`); }
    else if (a === 'diag') {
      const open = $('diagWrap').hidden; $('diagWrap').hidden = !open; el.setAttribute('aria-expanded', String(open)); el.textContent = open ? 'Hide problem report' : 'Show problem report';
      if (open) {
        const bad = (data.health || []).filter((h) => h && h.ok === false).length;
        $('diagBox').value = [`Report made ${new Date().toISOString()}`, `Page: ${location.host}${location.pathname}`, `Browser: ${navigator.userAgent}`,
          `Job list dated: ${data.generatedAt || 'none'}${data.sample ? ' (starter rows)' : ''}`, `Jobs: ${data.jobs.length}. Companies: ${data.companies.length}. Sites not read: ${bad}.`,
          ...(data.boards || []).map((b) => `Board ${b.name}: ${b.off || (b.ok ? `read ${num(b.postings)}, kept ${num(b.matched)}` : 'failed. ' + (b.error || ''))}`),
          `Saved on this device: ${Object.keys(marks.jobs).length} job marks, ${docs.length} documents.`, '--- recent activity ---', ...(diag.length ? diag : ['Nothing logged yet.'])].join('\n');
        $('diagBox').focus();
      }
    }
    else if (a === 'copyDiag') { const box = $('diagBox'); (navigator.clipboard?.writeText(box.value) || Promise.reject()).then(() => say('Report copied.'), () => { box.focus(); box.select(); say('Copy is not available here. The report is selected so you can copy it.'); }); }
    else if (a === 'checkLink' || a === 'saveCompany') linkAction(a);
    else if (a === 'fixLink') { $('vId').value = cid; $('vName').value = co.get(cid)?.name || ''; $('vType').value = Object.hasOwn(TYPE, co.get(cid)?.type) ? co.get(cid).type : 'other'; $('vUrl').value = ''; $('vSave').disabled = true; $('vMsg').textContent = `Paste the careers page link for ${cname}, then check it.`; $('vUrl').focus(); }
    else if (a === 'closeDialog') $(el.dataset.dialog).close();
    else if (a === 'hide' || a === 'unhide') {
      const next = el.closest('.row').nextElementSibling || el.closest('.row').previousElementSibling;
      const nextId = next?.dataset?.id;
      setMark(id, { status: a === 'hide' ? 'hidden' : '', log: [...(mark(id).log || []), { d: today(), s: a === 'hide' ? 'hidden' : '' }].slice(-50) });
      render();
      const target = nextId && document.querySelector(`.row[data-id="${q(nextId)}"] h3 a`);
      if (target) target.focus(); else document.querySelector(`[data-tab="${tab}"]`)?.focus();
      say(`${a === 'hide' ? 'Hidden' : 'Showing again'}: ${job?.title || 'job'}. ${shownCount} ${shownCount === 1 ? 'job' : 'jobs'} left in this list.`);
    }
    else if (a === 'tailor') openTailor(id, {}, pathTo(el));
    else if (a === 'runTailor') runTailor();
    else if (a === 'copyT') { (navigator.clipboard?.writeText($(el.dataset.from).value) || Promise.reject()).then(() => { $('tMsg').textContent = 'Copied.'; }, () => { $('tMsg').textContent = 'Copy is not available here. Select the text and copy it.'; }); }
    else if (a === 'saveTailor') {
      const j = tailorJob, c = co.get(j.companyId) || { name: '' }, stamp = Date.now();
      const label = `${c.name}, ${j.title} (tailored ${fmtDate(new Date())})`.slice(0, 160);
      const r = { id: 'd' + stamp, kind: 'resume', label, addedAt: new Date().toISOString(), text: $('tResume').value };
      const cv = { id: 'd' + (stamp + 1), kind: 'cover', label, addedAt: new Date().toISOString(), text: $('tCover').value };
      Promise.all([addDoc(r), addDoc(cv)]).then(() => { setMark(j.id, { resumeId: r.id, coverId: cv.id }); render(); $('tMsg').textContent = 'Saved to Documents and linked to this job.'; });
    }
    else if (a === 'install') openInstall(pathTo(el) || '[data-action="install"]');
    else if (a === 'doInstall') { $('installDialog').close(); installEvent?.prompt(); installEvent = null; }
    else if (a === 'addReq') {
      const name = $('reqName').value.trim().slice(0, 120); if (!name) { $('reqName').focus(); say('Type a company name first.'); return; }
      if (marks.requests.length >= 100) { say('The request list is full. Copy it and remove some.'); return; }
      marks.requests.push({ name, url: $('reqUrl').value.trim().slice(0, 300) }); $('reqName').value = $('reqUrl').value = ''; save(); renderCompanies(); $('reqName').focus(); say(`Added ${name} to your requests.`);
    }
    else if (a === 'delReq') { const gone = marks.requests.splice(num(el.dataset.i), 1)[0]; save(); renderCompanies(); $('reqName').focus(); say(`Removed ${gone?.name || 'request'}.`); }
    else if (a === 'copyReq') {
      const list = marks.requests.map((r) => r.name + (r.url ? ' ' + r.url : '')).join('\n');
      (navigator.clipboard?.writeText(list) || Promise.reject()).then(() => say('Requests copied.'), () => say('Copy is not available here.'));
    }
    else if (a === 'copyHealth') {
      const box = $('badList');
      (navigator.clipboard?.writeText(box.value) || Promise.reject()).then(() => say('List copied.'), () => { box.focus(); box.select(); say('Copy is not available here. The list is selected so you can copy it.'); });
    }
    else if (a === 'pickDoc') { if (!$('docLabel').value.trim()) { $('docLabel').focus(); say('Give the version a name first.'); return; } $('docFile').click(); }
    else if (a === 'delDoc') {
      const d = docs.find((x) => x.id === docId);
      docs = docs.filter((x) => x.id !== docId); idb.del(docId).catch(() => {});
      for (const m of Object.values(marks.jobs)) { if (m.resumeId === docId) delete m.resumeId; if (m.coverId === docId) delete m.coverId; }
      save(); renderDocs(); $('docLabel').focus(); say(`Deleted ${d?.label || 'the file'}.`);
    }
    else if (a === 'getDoc') {
      const d = docs.find((x) => x.id === docId); if (!d) return;
      download(d.blob || new Blob([d.text || ''], { type: 'text/plain' }), d.fileName || String(d.label).replace(/[^\w ,()-]+/g, '').slice(0, 80) + '.txt');
    }
    else if (a === 'export') {
      const { code, ...rest } = marks; // the access code never goes into a backup file
      download(new Blob([JSON.stringify(rest, null, 1)], { type: 'application/json' }), 'job-watch-backup.json');
      $('ioMsg').textContent = 'Backup saved to your downloads.';
    }
    else if (a === 'import') $('importFile').click();
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.addEventListener('change', (e) => {
    const el = e.target, id = el.closest('.row')?.dataset.id, a = el.dataset.action;
    if (a === 'status') {
      if (!Object.hasOwn(STATUS_NAME, el.value)) return;
      const patch = { status: el.value, log: [...(mark(id).log || []), { d: today(), s: el.value }].slice(-50) };
      if (el.value === 'applied' && !mark(id).date) patch.date = today();
      const title = data.jobs.find((x) => x.id === id)?.title || 'Job';
      setMark(id, patch); redraw(el, `[data-tab="${tab}"]`);
      say(`${title}: status set to ${STATUS_NAME[el.value]}.`);
    } else if (a === 'date') { if (el.value === '' || DATE.test(el.value)) setMark(id, { date: el.value }); }
    else if (a === 'notes') setMark(id, { notes: el.value.slice(0, 5000) });
    else if (a === 'resumeId' || a === 'coverId') setMark(id, { [a]: el.value.slice(0, 60) });
    else if (el.id === 'baseResume' || el.id === 'baseCover') { marks.base = { resume: $('baseResume').value.slice(0, 30000), cover: $('baseCover').value.slice(0, 30000) }; save(); say('Saved.'); }
    else if (el.id === 'docFile' && el.files[0]) {
      const f = el.files[0];
      if (f.size > 10 * 1024 * 1024) { el.value = ''; say('That file is over 10 MB. Choose a smaller one.'); $('docHint').textContent = 'That file is over 10 MB. Choose a smaller one.'; return; }
      const label = $('docLabel').value.trim().slice(0, 120);
      addDoc({ id: 'd' + Date.now(), kind: $('docKind').value === 'cover' ? 'cover' : 'resume', label, fileName: f.name.slice(0, 200), addedAt: new Date().toISOString(), blob: f })
        .then(() => { $('docLabel').value = ''; el.value = ''; renderDocs(); $('docLabel').focus(); say(`Added ${label}.`); });
    }
    else if (el.id === 'importFile' && el.files[0]) {
      const f = el.files[0]; el.value = '';
      const fail = () => { $('ioMsg').textContent = 'That file could not be read as a backup. Nothing was changed.'; };
      if (f.size > 2 * 1024 * 1024) return fail();
      f.text().then((t) => {
        const raw = JSON.parse(t);
        if (!raw || typeof raw !== 'object' || typeof raw.jobs !== 'object') return fail();
        const keep = marks.code, seen = marks.installSeen; marks = clean(raw); marks.code = keep; marks.installSeen = seen; marks.lastVisit = new Date().toISOString(); // the code and the home screen prompt belong to this device
        save(); render(); $('ioMsg').textContent = 'Backup loaded.';
      }).catch(fail);
    }
    else if (el.id === 'vUrl' || el.id === 'vName') { if (el.id === 'vUrl') $('vSave').disabled = true; if (el.id === 'vName') $('vId').value = ''; }
    else if (el.closest('.filters')) {
      if (el.id === 'fBoards') { marks.showBoards = el.checked; save(); }
      if (el.id === 'fMin') { const floor = num(data.profile?.minBase); if (el.value !== '' && floor && num(el.value) < floor) { el.value = floor; $('ioMsg').textContent = ''; } }
      renderJobs(); say(`${shownCount} ${shownCount === 1 ? 'job' : 'jobs'} shown.`); }
  });
  $('fMin').addEventListener('input', () => renderJobs());

  // Dialogs: click outside closes, focus goes back to the button that opened it.
  for (const id of ['coDialog', 'installDialog', 'tailorDialog']) {
    const d = $(id);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => {
      if (id === 'installDialog') { marks.installSeen = true; save(); }
      const back = opener && document.querySelector(opener); opener = null;
      if (back) back.focus();
    });
  }

  // ----- load -----
  function useData(d) {
    const arr = (v) => (Array.isArray(v) ? v : []);
    data = {
      sample: d?.sample === true, generatedAt: d?.generatedAt, profile: d?.profile || {},
      health: arr(d?.health).filter((h) => h && typeof h === 'object'),
      companies: arr(d?.companies).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string'),
      jobs: arr(d?.jobs).filter((j) => j && goodKey(j.id) && typeof j.title === 'string' && typeof j.companyId === 'string'),
    };
    co = new Map(data.companies.map((c) => [c.id, c]));
    data.boards = Array.isArray(d?.boards) ? d.boards : [];
    const floor = num(data.profile.minBase); if (floor) { $('fMin').min = floor; $('fMin').placeholder = floor; }
    render();
  }
  const sample = () => { const el = $('sample'); if (!el) throw new Error('no data'); return JSON.parse(el.textContent); };
  if (window.matchMedia('(min-width: 1181px)').matches) $('filt').open = true;
  $('fBoards').checked = marks.showBoards !== false;
  fetch('data/jobs.json', { cache: 'no-store', credentials: 'omit' }).then((r) => { note(`data/jobs.json answered ${r.status}`); if (!r.ok) throw new Error('missing'); return r.json(); }).then(useData)
    .catch(() => { try { useData(sample()); } catch { $('summary').textContent = 'The job list could not be loaded. Try again later.'; } })
    .finally(() => {
      idb.all().then((d) => { docs = (d || []).filter((x) => x && typeof x.id === 'string' && typeof x.label === 'string'); if (docs.length) render(); }).catch(() => {});
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      if (!marks.installSeen && !standalone) setTimeout(() => { if (!document.querySelector('dialog[open]')) openInstall('#top'); }, 1200);
    });
})();
