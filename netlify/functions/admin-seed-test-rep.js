// POST /api/admin-seed-test-rep   { code: "<admin access code>" }
//
// Creates (or refreshes) the Philips PH-201 test reps that can check into
// EVERY store the surveys cover — 510 stores, Dis-Chem excluded — so the
// three weekly surveys can be tested end to end without borrowing a real
// rep's diary.
//
//   fleet@retailstar.co.za    signs in with the permanent code below
//   chris@leegra.co.za        signs in with the SHARED access code, which
//                             opens the rep app instead of the dashboards
//                             (see auth-login.js) — his admin code still
//                             takes him to the dashboards as before
//
// Its permanent code is NOT written here: it is read from
// TEST_REP_PERMANENT_CODE, or failing that the current shared access code
// (ACCESS_CODE_CURRENT). Netlify's secret scanner fails any build whose
// source contains a live env value, so the code must never be a literal in
// this repo — and reading it from the env means the test rep's code follows
// the shared code automatically when it rotates.
//
// The store list is read from _philips-survey-seed.json, the same list the
// questionnaires are scoped to, so the test rep and the surveys can never
// drift apart.
//
// This is a real tenant user with a fixedCode, which is the same mechanism
// the 9 field reps use (see auth-login.js) — no special-casing in the login
// path. Idempotent: merged by email, so re-running only refreshes this one
// account and never touches the real reps.
//
// Auth is the monthly admin access code in the body, not a JWT — same
// pattern as admin-seed-philips.js.

const accessCode = require('./_lib/accesscode');
const { getUsers, saveUsers } = require('./_lib/records');
const SEED = require('./_philips-survey-seed.json');

const TEST_REPS = [
  { email: 'fleet@retailstar.co.za', name: 'Fleet Test Rep', role: 'field_rep', useCode: true },
  // No fixedCode: Chris reaches the rep app with the shared access code, which
  // auth-login resolves against this record. Giving him a fixedCode here would
  // be a second credential to keep in step for no gain.
  { email: 'chris@leegra.co.za', name: 'Chris (rep test)', role: 'field_rep', useCode: false },
];

function testRepCode() {
  const fromEnv = (process.env.TEST_REP_PERMANENT_CODE || process.env.ACCESS_CODE_CURRENT || '').trim();
  return fromEnv || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin code required' }) };
  }

  const tenantCode = SEED.tenantCode;
  const storeCodes = (SEED.questionnaires[0]?.storeCodes || []);
  if (!storeCodes.length) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Survey seed carries no store list' }) };
  }

  const code = testRepCode();
  if (!code) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'No code available — set TEST_REP_PERMANENT_CODE or ACCESS_CODE_CURRENT in the Netlify env vars.' }),
    };
  }

  const users = await getUsers(tenantCode);
  const seeded = [];
  for (const rep of TEST_REPS) {
    const { useCode, ...fields } = rep;
    const idx = users.findIndex(u => u.email.toLowerCase() === rep.email);
    const record = Object.assign({}, idx >= 0 ? users[idx] : {}, fields, {
      storeCodes: [...storeCodes],
      updatedAt: new Date().toISOString(),
    });
    if (useCode) record.fixedCode = code;
    if (idx >= 0) users[idx] = record; else users.push(record);
    seeded.push({
      email: record.email,
      code: useCode ? record.fixedCode : 'your shared access code',
      stores: record.storeCodes.length,
      created: idx < 0,
    });
  }
  await saveUsers(tenantCode, users);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      tenant_code: tenantCode,
      excluded: SEED.excluded,
      test_rep: seeded[0],
      test_reps: seeded,
      users_total: users.length,
    }),
  };
};
