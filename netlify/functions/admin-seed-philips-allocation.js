// POST /api/admin-seed-philips-allocation   { code: "<admin access code>", include_dischem?: boolean }
//
// Allocates the October 2026 call-diary stores (_philips-oct-allocation.json)
// to each Philips PH-201 Blitz member, and scopes the three weekly-cadence
// surveys (Stock Count & Pricing, Execution (Image Report), Competitor
// Feedback) to every allocated store.
//
// - Each rep's storeCodes are REPLACED by their October diary stores; any
//   OFF-* (off-diary call) code they already had is kept.
// - Surveys are opened to every store (storeCodes cleared = all stores).
// - Reps not in the October file (e.g. Mzwakhe) are untouched.
// - Idempotent: re-running just re-applies the same allocation.

const accessCode = require('./_lib/accesscode');
const { getUsers, saveUsers, getStores, getQuestionnaires, saveQuestionnaires } = require('./_lib/records');
const ALLOC = require('./_philips-oct-allocation.json');

const SURVEY_IDS = ['ph_stock_pricing', 'ph_execution_image', 'ph_competitor_feedback'];
const isDischem = (name) => /dis[\s-]*chem|dischem/i.test(String(name || ''));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin code required' }) };
  }
  const includeDischem = body.include_dischem === true;
  const tenantCode = ALLOC.tenantCode;

  const [users, stores, questionnaires] = await Promise.all([
    getUsers(tenantCode), getStores(tenantCode), getQuestionnaires(tenantCode),
  ]);
  const nameByCode = Object.fromEntries(stores.map(s => [s.code, s.name]));

  const allocated = new Set();
  const reps = [];
  for (const rep of ALLOC.reps) {
    const idx = users.findIndex(u => (u.email || '').toLowerCase() === (rep.email || '').toLowerCase());
    if (idx < 0) { reps.push({ email: rep.email, name: rep.name, error: 'user not found on tenant' }); continue; }
    const known = rep.storeCodes.filter(c => nameByCode[c]);
    const offDiary = (users[idx].storeCodes || []).filter(c => /^OFF-/i.test(c));
    users[idx] = { ...users[idx], storeCodes: [...new Set([...offDiary, ...known])], allocationSource: ALLOC.period, updatedAt: new Date().toISOString() };
    known.forEach(c => allocated.add(c));
    reps.push({ email: rep.email, name: rep.name, stores: users[idx].storeCodes.length, missing_from_store_list: rep.storeCodes.length - known.length, unmatched_diary_entries: rep.unmatched.length });
  }

  // Surveys run at EVERY store: an empty storeCodes list = all stores.
  const surveys = [];
  for (const q of questionnaires) {
    if (!SURVEY_IDS.includes(q.id)) continue;
    const before = (q.storeCodes || []).length;
    q.storeCodes = [];
    q.updatedAt = new Date().toISOString();
    surveys.push({ id: q.id, name: q.name, stores_before: before, stores_after: q.storeCodes.length });
  }

  await Promise.all([saveUsers(tenantCode, users), saveQuestionnaires(tenantCode, questionnaires)]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, tenant_code: tenantCode, period: ALLOC.period, include_dischem: includeDischem, reps, surveys, surveys_missing: SURVEY_IDS.filter(id => !surveys.some(s => s.id === id)) }),
  };
};
