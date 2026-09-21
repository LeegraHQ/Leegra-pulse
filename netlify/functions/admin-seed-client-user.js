// POST /api/admin-seed-client-user
//   { code: "<admin access code>", email, login_code, tenant_code?, role?, name? }
//
// Creates (or refreshes) ONE client-side login that signs in with a code you
// choose, instead of an emailed one-time code. This exists for client
// contacts whose corporate mail server blocks or delays our OTP — Philips
// being the case it was written for.
//
// The mechanism is nothing new: it writes a `fixedCode` onto the tenant's
// user record, exactly as the 9 field reps use (see auth-login.js, which
// checks fixedCode before falling back to the OTP). The only thing this adds
// over admin-users-assign's reset_code action is that YOU pick the code
// rather than getting a random six digits back — which is what makes it
// usable in a live demo.
//
// Defaults: tenant PH-201, role client_manager (dashboard read access to
// every store on the tenant; a client_manager is not a field rep, so no
// store allocation is needed and none is written).
//
// The code is never a literal in this file — it arrives in the request body.
// Netlify's secret scanner fails any build whose source carries a live
// credential, and a demo code in git would be exactly that.
//
// Idempotent: merged by email, so re-running refreshes this one account and
// never touches another user. Auth is the monthly admin access code in the
// body, not a JWT — same pattern as admin-seed-philips.js.

const accessCode = require('./_lib/accesscode');
const { getUsers, saveUsers } = require('./_lib/records');

const CLIENT_ROLES = ['client_manager', 'client_admin', 'field_rep'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin code required' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  const loginCode = String(body.login_code || '').trim();
  const tenantCode = (body.tenant_code || 'PH-201').trim().toUpperCase();
  const role = CLIENT_ROLES.includes(body.role) ? body.role : 'client_manager';

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'A valid email is required' }) };
  }
  if (loginCode.length < 4) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'login_code must be at least 4 characters' }) };
  }
  // A field rep's stores are the permission boundary and come from their
  // diary, not from here — refuse rather than create a rep with no stores.
  if (role === 'field_rep') {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Field reps are provisioned from their call diary — use admin-seed-philips.' }) };
  }

  const users = await getUsers(tenantCode);
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === email);
  const record = Object.assign({}, idx >= 0 ? users[idx] : {}, {
    email,
    role,
    // A non-rep sees the whole tenant, so the allocation list stays empty.
    storeCodes: [],
    fixedCode: loginCode,
    updatedAt: new Date().toISOString(),
  });
  if (body.name) record.name = body.name;
  if (idx >= 0) users[idx] = record; else users.push(record);
  await saveUsers(tenantCode, users);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      tenant_code: tenantCode,
      email: record.email,
      role: record.role,
      created: idx < 0,
      users_total: users.length,
    }),
  };
};
