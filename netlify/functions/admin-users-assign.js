// POST /api/admin-users-assign
// Body: { email, role: 'field_rep'|'client_manager'|'client_admin', store_codes: ['GAM-118', ...] }
// Provisions (or updates) a staff login and which of the tenant's stores
// they can see. Login itself no longer needs a stored code here — see
// auth-request-code.js/auth-login.js, which email a fresh one-time code to
// whatever address is on this record. This is the enforcement point for
// "staff only see what's been allocated to them" — a field_rep's session
// only ever includes stores present in this assignment list.

const jwt = require('./_lib/jwt');
const { blobsStore } = require('./_lib/records');
const { LEEGRA_WRITE_ROLES } = require('./_data');

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
  const record = {
    email: body.email,
    role: body.role || 'field_rep',
    storeCodes: body.store_codes,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) users[idx] = record; else users.push(record);
  await store.setJSON('list', users);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, user: record }) };
};
