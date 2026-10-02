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
const { blobsStore, getUsers, saveUsers, getStores, getQuestionnaires, saveQuestionnaires } = require('./_lib/records');

// Diary stores with no Philips store code are added as stores anyway, under a
// stable placeholder code (same name -> same code, so re-runs never duplicate).
const tbcCode = (name) => 'TBC-' + String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const guessChannel = (n) => { n = String(n).toUpperCase();
  if (/DIS|DISH/.test(n) && /CHEM|HEM/.test(n)) return 'Dis-Chem';
  if (/CLICK/.test(n)) return 'Clicks'; if (/CHECKER/.test(n)) return 'Checkers';
  if (/BABY ?CITY/.test(n)) return 'Baby City'; if (/BABIES|BRU/.test(n)) return 'Babies R Us';
  if (/MAKRO/.test(n)) return 'Makro'; if (/MEDIRITE/.test(n)) return 'Medirite'; return 'Other'; };
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
  let storesAdded = 0;
  for (const rep of ALLOC.reps) {
    for (const name of rep.unmatched || []) {
      const code = tbcCode(name);
      if (nameByCode[code]) continue;
      stores.push({ code, name, channel: guessChannel(name), region: '', codePending: true, source: 'October 2026 call diary (no Philips code yet)' });
      nameByCode[code] = name;
      storesAdded++;
    }
  }

  const allocated = new Set();
  const reps = [];
  for (const rep of ALLOC.reps) {
    const idx = users.findIndex(u => (u.email || '').toLowerCase() === (rep.email || '').toLowerCase());
    if (idx < 0) { reps.push({ email: rep.email, name: rep.name, error: 'user not found on tenant' }); continue; }
    const known = [...rep.storeCodes.filter(c => nameByCode[c]), ...(rep.unmatched || []).map(tbcCode)];
    const offDiary = (users[idx].storeCodes || []).filter(c => /^OFF-/i.test(c));
    users[idx] = { ...users[idx], storeCodes: [...new Set([...offDiary, ...known])], allocationSource: ALLOC.period, updatedAt: new Date().toISOString() };
    known.forEach(c => allocated.add(c));
    reps.push({ email: rep.email, name: rep.name, stores: users[idx].storeCodes.length, missing_from_store_list: rep.storeCodes.filter(c => !nameByCode[c]).length, unmatched_diary_entries: rep.unmatched.length });
  }

  // Demo Blitz account (TEST_REP_EMAIL — the Fleet demo login) gets EVERY
  // store, so a demo can check in anywhere and run all three surveys. The
  // address stays in the env var: Netlify's secret scanner fails a build that
  // has it as a literal.
  const demoEmail = (process.env.TEST_REP_EMAIL || '').trim().toLowerCase();
  let demo = { email: demoEmail || null, error: demoEmail ? null : 'TEST_REP_EMAIL not set' };
  if (demoEmail) {
    const di = users.findIndex(u => (u.email || '').toLowerCase() === demoEmail);
    if (di < 0) demo.error = 'demo user not found on tenant — run admin-seed-test-rep first';
    else {
      users[di] = { ...users[di], storeCodes: stores.map(s => s.code), allocationSource: 'Demo: all stores', updatedAt: new Date().toISOString() };
      demo = { email: demoEmail, stores: users[di].storeCodes.length };
    }
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

  await Promise.all([
    saveUsers(tenantCode, users),
    saveQuestionnaires(tenantCode, questionnaires),
    blobsStore(`stores-${tenantCode}`).setJSON('base', stores),
  ]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, tenant_code: tenantCode, period: ALLOC.period, stores_added_without_code: storesAdded, stores_total: stores.length, include_dischem: includeDischem, reps, demo_account: demo, surveys, surveys_missing: SURVEY_IDS.filter(id => !surveys.some(s => s.id === id)) }),
  };
};
