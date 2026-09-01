// POST /api/admin-seed-test-rep   { code: "<admin access code>" }
//
// Creates (or refreshes) one Philips PH-201 test rep that can check into
// EVERY store the surveys cover — 510 stores, Dis-Chem excluded — so the
// three weekly surveys can be tested end to end without borrowing a real
// rep's diary.
//
//   fleet@retailstar.co.za    permanent code 1105
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

const TEST_REP = {
  email: 'fleet@retailstar.co.za',
  name: 'Fleet Test Rep',
  role: 'field_rep',
  fixedCode: '1105',
};

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

  const users = await getUsers(tenantCode);
  const idx = users.findIndex(u => u.email.toLowerCase() === TEST_REP.email);
  const record = Object.assign({}, idx >= 0 ? users[idx] : {}, TEST_REP, {
    storeCodes: [...storeCodes],
    updatedAt: new Date().toISOString(),
  });
  if (idx >= 0) users[idx] = record; else users.push(record);
  await saveUsers(tenantCode, users);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      tenant_code: tenantCode,
      created: idx < 0,
      test_rep: {
        email: record.email,
        code: record.fixedCode,
        stores: record.storeCodes.length,
        excluded: SEED.excluded,
      },
      users_total: users.length,
    }),
  };
};
