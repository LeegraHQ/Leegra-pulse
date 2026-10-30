// POST /api/hatfield-audits  { action, email, code, ... }
//   ping | login | data | save-audit | save-schedule | save-date | upload-proof | delete-proof
// GET  /api/hatfield-audits?photo=<id>  → proof-of-audit file
// Hatfield Motor Group (HAT-009) mystery-shopping audits. Base audits + logins
// come from _hatfield-audit-data.json (the client's Excel template). Audits the
// shopper captures on the mobile app, calendar dates and proof-of-audit files
// are stored in Netlify Blobs; proof files go to Supabase Storage via savePhoto.
// Chris signs in with the Pulse admin code (ADMIN_ACCESS_CODE).

const accessCode = require('./_lib/accesscode');
const { blobsStore, savePhoto, getPhoto, deletePhoto } = require('./_lib/records');
const BASE = require('./_hatfield-audit-data.json');

const TENANT = 'HAT-009';
const MAX_BYTES = 4.5 * 1024 * 1024;
const VIEWS = { super: ['calendar', 'info', 'costing'], group: ['calendar', 'costing'], dealer: [], dept: [], shopper: [] };
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const strip = l => { const { code, ...u } = l; return u; };

function findLogin(email, code) {
  const em = clip(email, 120).toLowerCase(), c = clip(code, 64);
  if (!em || !c) return null;
  const l = BASE.logins.find(x => x.email.toLowerCase() === em);
  if (!l) return null;
  if (l.role === 'super') return accessCode.isAdminCode(c) ? l : null;
  return String(l.code) === c ? l : null;
}
const can = (u, view) => (VIEWS[u.role] || []).includes(view);
const dealerOk = (u, d) => u.dealers === 'ALL' || u.dealers.includes(d);
const deptOk = (u, d) => u.depts === 'ALL' || u.depts.includes(d);
const auditKey = a => `${a.dealer}|${a.dept}|${a.auditNo}`;

async function listJSON(store) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) { try { const v = await store.get(b.key, { type: 'json' }); if (v) out.push(v); } catch {} }
  return out;
}

exports.handler = async (event) => {
  const meta = blobsStore(`hatfield-meta-${TENANT}`);
  const capturedStore = blobsStore(`hatfield-captured-${TENANT}`);
  const proofStore = blobsStore(`hatfield-proof-${TENANT}`);

  if (event.httpMethod === 'GET') {
    const id = clip(event.queryStringParameters && event.queryStringParameters.photo, 80);
    if (!/^hp-[a-z0-9-]+$/i.test(id)) return json(400, { error: 'Bad id' });
    const rec = await proofStore.get(id, { type: 'json' });
    const file = await getPhoto(TENANT, id);
    if (!file) return json(404, { error: 'Not found' });
    return { statusCode: 200, isBase64Encoded: true, headers: { 'Content-Type': (rec && rec.mime) || file.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }, body: Buffer.from(file.bytes).toString('base64') };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (body.action === 'ping') return json(200, { ok: true });

  const u = findLogin(body.email, body.code);
  if (!u) return json(403, { error: 'Email and code do not match an assigned log in.' });
  if (body.action === 'login') return json(200, { ok: true, user: strip(u) });

  if (body.action === 'data') {
    const captured = await listJSON(capturedStore);
    const audits = BASE.audits.slice();
    captured.forEach(c => { const i = audits.findIndex(a => auditKey(a) === auditKey(c)); if (i >= 0) audits[i] = c; else audits.push(c); });
    const proofList = await listJSON(proofStore);
    const proof = {};
    proofList.forEach(p => {
      const [d, dp] = p.key.split('|');
      if (!dealerOk(u, d) || !deptOk(u, dp)) return;
      (proof[p.key] = proof[p.key] || []).push({ id: p.id, cat: p.cat, name: p.name, mime: p.mime, at: p.at, url: p.link || '/api/hatfield-audits?photo=' + p.id });
    });
    const data = {
      client: BASE.client,
      dealers: BASE.dealers.filter(d => dealerOk(u, d.name)).map(d => u.role === 'super' ? d : { ...d, code: '' }),
      audits: audits.filter(a => dealerOk(u, a.dealer) && deptOk(u, a.dept)),
      costing: can(u, 'costing') ? BASE.costing.filter(c => dealerOk(u, c.dealer)) : [],
      costingTotal: can(u, 'costing') ? BASE.costingTotal : null,
      logins: u.role === 'super' ? BASE.logins.map(l => l.role === 'super' ? strip(l) : l) : [],
      questionBank: BASE.questionBank,
    };
    return json(200, {
      ok: true, user: strip(u), data, proof,
      schedule: can(u, 'calendar') ? ((await meta.get('schedule', { type: 'json' })) || {}) : {},
      dates: (await meta.get('dates', { type: 'json' })) || {},
    });
  }

  if (body.action === 'save-audit') {
    if (!['shopper', 'super'].includes(u.role)) return json(403, { error: 'Only the shopper can submit audits' });
    const a = body.audit || {};
    const dept = clip(a.dept, 10), dealer = clip(a.dealer, 80), auditNo = Number(a.auditNo);
    if (!BASE.dealers.some(d => d.name === dealer) || !BASE.questionBank[dept] || !(auditNo > 0)) return json(400, { error: 'Pick a dealer, department and audit number' });
    const rows = (Array.isArray(a.rows) ? a.rows : []).slice(0, 40).map(r => ({
      section: clip(r.section, 80), weight: Number(r.weight) || 0, question: clip(r.question, 300),
      score: r.score == null || r.score === '' ? null : Math.max(0, Math.min(1, Number(r.score))), evidence: clip(r.evidence, 1500),
    }));
    const rec = {
      dealer, dept, auditNo, rows, state: 'complete', source: 'capture-app',
      auditDate: clip(a.auditDate, 10), staff: clip(a.staff, 80), action: clip(a.action, 1500), owner: clip(a.owner, 80),
      due: clip(a.due, 10), status: clip(a.status, 20) || 'Open', capturedBy: u.email, capturedAt: new Date().toISOString(),
    };
    await capturedStore.setJSON(auditKey(rec).replace(/[^a-zA-Z0-9]/g, '_'), rec);
    return json(200, { ok: true });
  }

  if (body.action === 'save-schedule') {
    if (!can(u, 'calendar')) return json(403, { error: 'No calendar access' });
    const dealer = clip(body.dealer, 80), field = body.field === 'follow' ? 'follow' : 'next';
    if (!dealerOk(u, dealer)) return json(403, { error: 'Not your dealership' });
    const sc = (await meta.get('schedule', { type: 'json' })) || {};
    sc[dealer] = { ...(sc[dealer] || {}), [field]: clip(body.value, 10) };
    await meta.setJSON('schedule', sc);
    return json(200, { ok: true });
  }

  if (body.action === 'save-date') {
    if (u.role !== 'super') return json(403, { error: 'Super user only' });
    const d = (await meta.get('dates', { type: 'json' })) || {};
    d[clip(body.key, 160)] = clip(body.value, 10);
    await meta.setJSON('dates', d);
    return json(200, { ok: true });
  }

  if (body.action === 'save-dates') {
    if (u.role !== 'super') return json(403, { error: 'Super user only' });
    const d = (await meta.get('dates', { type: 'json' })) || {};
    let n = 0;
    Object.entries(body.dates || {}).slice(0, 500).forEach(([k, v]) => { const val = clip(v, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(val)) { d[clip(k, 160)] = val; n++; } });
    await meta.setJSON('dates', d);
    return json(200, { ok: true, saved: n });
  }

  if (body.action === 'add-proof-link') {
    if (u.role !== 'super') return json(403, { error: 'Only Leegra can add proof of audit' });
    const url = clip(body.url, 500);
    if (!/^https?:\/\//i.test(url)) return json(400, { error: 'Paste a full link starting with https://' });
    const id = 'hl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await proofStore.setJSON(id, { id, key: clip(body.key, 160), cat: 'video', name: clip(body.name, 120) || url, mime: 'text/uri-list', link: url, by: u.email, at: new Date().toISOString() });
    return json(200, { ok: true, id });
  }

  if (body.action === 'upload-proof') {
    if (u.role !== 'super') return json(403, { error: 'Only Leegra can upload proof of audit' });
    const key = clip(body.key, 160);
    const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(body.dataUrl || ''));
    if (!m || !/^(image\/|application\/pdf)/i.test(m[1])) return json(400, { error: 'Photos or PDFs only' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_BYTES) return json(400, { error: 'File too large (max 4.5 MB)' });
    const id = 'hp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const storage = await savePhoto(TENANT, id, buf, m[1]);
    const rec = { id, key, cat: clip(body.cat, 20) || 'photo', name: clip(body.name, 120), mime: m[1], storage, by: u.email, at: new Date().toISOString() };
    await proofStore.setJSON(id, rec);
    return json(200, { ok: true, id });
  }

  if (body.action === 'delete-proof') {
    const id = clip(body.id, 80);
    const rec = await proofStore.get(id, { type: 'json' });
    if (!rec) return json(404, { error: 'Not found' });
    if (u.role !== 'super' && rec.by !== u.email) return json(403, { error: 'You can only remove your own uploads' });
    await deletePhoto(TENANT, id).catch(() => {});
    await proofStore.delete(id);
    return json(200, { ok: true });
  }

  return json(400, { error: 'Unknown action' });
};
