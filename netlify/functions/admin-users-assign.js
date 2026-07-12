// POST /api/admin-users-assign
// Body: { email, role: 'field_rep'|'client_manager'|'client_admin', store_codes: ['GAM-118', ...], security_code? }
// Provisions (or updates) a staff login, which of the tenant's stores they
// can see, and their individual security code — required alongside their
// email to actually log in (see auth-login.js). Omit security_code to
// auto-generate a fresh 6-digit one (returned in the response so you can
// hand it to that person); re-run with an explicit security_code to reset
// it. This is the enforcement point for "staff only see what's been
// allocated to them" — a field_rep's session only ever includes stores
// present in this assignment list.

const crypto = require('crypto');
const jwt = require('./_lib/jwt');
const { blobsStore } = require('./_lib/records');
const { LEEGRA_WRITE_ROLES } = require('./_data');

function generateSecurityCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 digits, zero-padding never needed
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (![...LEEGRA_WRITE_ROLES, 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : body.tenant_code;
  if (!tenantCode || !body.email || !Array.isArray(body.store_codes)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code, email and store_codes[] required' }) };
  }

  const store = blobsStore(`users-${tenantCode}`);
  const users = (await store.get('list', { type: 'json' })) || [];
  const idx = users.findIndex(u => u.email.toLowerCase() === body.email.toLowerCase());
  const securityCode = body.security_code || (idx >= 0 && users[idx].securityCode) || generateSecurityCode();
  const record = {
    email: body.email,
    role: body.role || 'field_rep',
    storeCodes: body.store_codes,
    securityCode,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) users[idx] = record; else users.push(record);
  await store.setJSON('list', users);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, user: record }) };
};
