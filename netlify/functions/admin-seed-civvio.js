// POST /api/admin-seed-civvio
//   { code: "<admin access code>",
//     stores?: [{ code, name, channel, region }],      // optional; defaults to _civvio-dmq-stores.json (44 stores)
//     rep: { email, name, login_code },                // the field rep
//     dashboard: { email, name, login_code } }         // the DMQ dashboard login
//
// One-shot setup for DMQ / Civvio (CIV-088):
//   1. Loads the store list (merged by code).
//   2. Saves the "DMQ Monthly Stand Check" questionnaire, scoped to those stores.
//   3. Creates the rep (field_rep, all listed stores) with a fixed login code.
//   4. Creates the DMQ dashboard login (client_manager) with a fixed login code.
// Codes arrive in the body — never literals in source (Netlify secret scanner).
// Idempotent: re-running refreshes the same records. Driven by /setup-civvio.html.

const accessCode = require('./_lib/accesscode');
const { blobsStore, getUsers, saveUsers, getQuestionnaires, saveQuestionnaires } = require('./_lib/records');

const SEED = require('./_civvio-dmq-stores.json');
const TENANT = 'CIV-088';
const QN_ID = 'dmq_monthly_stand';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

const QUESTIONS = [
  { id: 'dmq_facings', label: 'How many facings does the stand have?', type: 'number', required: true },
  { id: 'dmq_returns', label: 'Any returns on stock?', type: 'boolean', required: true },
  { id: 'dmq_damaged', label: 'Any damaged stock?', type: 'boolean', required: true },
  { id: 'dmq_additional_stock', label: 'Additional stock needed?', type: 'boolean', required: true },
  { id: 'dmq_stand_photo', label: 'Photo of the stand', type: 'photo', required: true },
  { id: 'dmq_extra_photo', label: 'Extra photo (optional)', type: 'photo', required: false },
  { id: 'dmq_comment', label: 'Comments', type: 'text', required: false },
];

function userRecord(existing, { email, name, role, code, storeCodes }) {
  return Object.assign({}, existing || {}, {
    email, role, storeCodes, fixedCode: code,
    ...(name ? { name } : {}),
    updatedAt: new Date().toISOString(),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!accessCode.isAdminCode((body.code || '').trim())) return json(403, { error: 'Admin code required' });

  const rep = body.rep || {}, dash = body.dashboard || {};
  const repEmail = clip(rep.email, 120).toLowerCase(), dashEmail = clip(dash.email, 120).toLowerCase();
  const repCode = clip(rep.login_code, 20), dashCode = clip(dash.login_code, 20);
  if (!repEmail.includes('@') || repCode.length < 4) return json(400, { error: 'Rep email and a login code of 4+ characters are required' });
  if (!dashEmail.includes('@') || dashCode.length < 4) return json(400, { error: 'Dashboard email and a login code of 4+ characters are required' });

  // 1. Stores
  const storeBlob = blobsStore(`stores-${TENANT}`);
  const existing = (await storeBlob.get('base', { type: 'json' })) || [];
  const byCode = new Map(existing.map(s => [s.code, s]));
  let added = 0;
  // Monthly flag is reset so the list in the seed file (or body) is the whole monthly list.
  for (const s of byCode.values()) delete s.dmqMonthly;
  for (const r of Array.isArray(body.stores) && body.stores.length ? body.stores : SEED.stores) {
    const code = clip(r.code, 40);
    if (!code || !clip(r.name, 160)) continue;
    if (!byCode.has(code)) added++;
    byCode.set(code, { ...(byCode.get(code) || {}), code, name: clip(r.name, 160), channel: clip(r.channel, 60) || 'Other', region: clip(r.region, 60) || 'Unassigned', plannedRep: clip(r.plannedRep, 60), dmqMonthly: true });
  }
  const stores = [...byCode.values()];
  await storeBlob.setJSON('base', stores);
  const monthly = stores.filter(s => s.dmqMonthly).map(s => s.code);

  // 2. Questionnaire
  const qns = await getQuestionnaires(TENANT);
  const qn = { id: QN_ID, name: 'DMQ Monthly Stand Check', storeCodes: monthly, visitType: 'dmq_stand', questions: QUESTIONS, updatedAt: new Date().toISOString() };
  const qi = qns.findIndex(q => q.id === QN_ID);
  if (qi >= 0) qns[qi] = qn; else qns.push(qn);
  await saveQuestionnaires(TENANT, qns);

  // 3 + 4. Users
  const users = await getUsers(TENANT);
  const taken = users.filter(u => ![repEmail, dashEmail].includes((u.email || '').toLowerCase())).map(u => u.fixedCode);
  if (taken.includes(repCode) || taken.includes(dashCode)) return json(409, { error: 'One of those login codes is already used by another Civvio user' });
  for (const u of [
    { email: repEmail, name: clip(rep.name, 80), role: 'field_rep', code: repCode, storeCodes: monthly },
    { email: dashEmail, name: clip(dash.name, 80), role: 'client_manager', code: dashCode, storeCodes: [] },
  ]) {
    const i = users.findIndex(x => (x.email || '').toLowerCase() === u.email);
    const rec = userRecord(i >= 0 ? users[i] : null, u);
    if (i >= 0) users[i] = rec; else users.push(rec);
  }
  await saveUsers(TENANT, users);

  return json(200, {
    ok: true, tenant_code: TENANT,
    stores_total: stores.length, stores_added: added, monthly_stores: monthly.length,
    questionnaire: { id: QN_ID, name: qn.name, questions: QUESTIONS.length },
    rep: { email: repEmail, stores: monthly.length },
    dashboard: { email: dashEmail },
  });
};
