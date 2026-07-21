// GET    /api/admin-users-assign?tenant_code=X   — list a tenant's user roster
//   (includes lastLoginAt so you can check whether someone has actually
//   logged in yet, without needing their inbox; also shows hasFixedCode,
//   never the code value itself, once one's been set)
// DELETE /api/admin-users-assign?tenant_code=X&email=Y   — remove a user's
//   access entirely (e.g. a wrong email address was assigned by mistake —
//   deletes rather than leaving it around with a still-working login code)
// POST /api/admin-users-assign
// Body: { email, role: 'field_rep'|'client_manager'|'client_admin', store_codes: ['GAM-118', ...] }
// Provisions (or updates) a staff login and which of the tenant's stores
// they can see. Login itself defaults to the emailed one-time code — see
// auth-request-code.js/auth-login.js. This is the enforcement point for
// "staff only see what's been allocated to them" — a field_rep's session
// only ever includes stores present in this assignment list.
//
// POST { tenant_code, email, reset_code: true }  — separate lightweight
// action (no store_codes needed): generates a fresh persistent fixedCode
// for an EXISTING user and returns it once in the response, for Leegra to
// relay out of band (phone/WhatsApp) to someone who isn't receiving the
// OTP email. Overwrites any previous fixedCode. Login still normally goes
// through the emailed OTP — the fixedCode is only an alternate credential,
// checked in auth-login.js. There's no automatic expiry; reset again to
// invalidate it.

const crypto = require('crypto');
const jwt = require('./_lib/jwt');
const { blobsStore, getUsers } = require('./_lib/records');
const { LEEGRA_WRITE_ROLES } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (![...LEEGRA_WRITE_ROLES, 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  if (event.httpMethod === 'GET') {
    const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (event.queryStringParameters?.tenant_code || claims.scopedTenantCode);
    if (!tenantCode) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code required for super-admin' }) };
    if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
    }
    const users = await getUsers(tenantCode);
    // Never return the fixedCode value itself over an API response that
    // could end up in logs — just whether one's set.
    const redacted = users.map(({ fixedCode, ...u }) => ({ ...u, hasFixedCode: !!fixedCode }));
    return { statusCode: 200, body: JSON.stringify({ tenant_code: tenantCode, users: redacted }) };
  }

  if (event.httpMethod === 'DELETE') {
    const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (event.queryStringParameters?.tenant_code || claims.scopedTenantCode);
    const email = event.queryStringParameters?.email;
    if (!tenantCode || !email) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code and email required' }) };
    if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
    }
    const store = blobsStore(`users-${tenantCode}`);
    const users = (await store.get('list', { type: 'json' })) || [];
    const remaining = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
    if (remaining.length === users.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No user with that email' }) };
    }
    await store.setJSON('list', remaining);
    return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, removed: email }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (body.tenant_code || claims.scopedTenantCode);
  if (!tenantCode || !body.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code and email required' }) };
  }
  if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
  }

  const store = blobsStore(`users-${tenantCode}`);
  const users = (await store.get('list', { type: 'json' })) || [];
  const idx = users.findIndex(u => u.email.toLowerCase() === body.email.toLowerCase());

  if (body.reset_code === true) {
    if (idx < 0) return { statusCode: 404, body: JSON.stringify({ error: 'No existing user with that email — assign them first' }) };
    const fixedCode = String(crypto.randomInt(100000, 1000000));
    users[idx] = { ...users[idx], fixedCode, updatedAt: new Date().toISOString() };
    await store.setJSON('list', users);
    return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, email: users[idx].email, fixed_code: fixedCode }) };
  }

  if (!Array.isArray(body.store_codes)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'store_codes[] required (or pass reset_code: true to just reset a login code)' }) };
  }
  const record = {
    email: body.email,
    role: body.role || 'field_rep',
    storeCodes: body.store_codes,
    // Preserve lastLoginAt and any fixedCode across a re-assignment (e.g.
    // adding more stores to someone who's already logged in) rather than
    // silently wiping them.
    ...(idx >= 0 && users[idx].lastLoginAt ? { lastLoginAt: users[idx].lastLoginAt } : {}),
    ...(idx >= 0 && users[idx].fixedCode ? { fixedCode: users[idx].fixedCode } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) users[idx] = record; else users.push(record);
  await store.setJSON('list', users);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, user: record }) };
};
