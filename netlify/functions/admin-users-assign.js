// GET  /api/admin-users-assign?tenant_code=X   — list a tenant's user roster
//   (includes lastLoginAt so you can check whether someone has actually
//   logged in yet, without needing their inbox)
// POST /api/admin-users-assign
// Body: { email, role: 'field_rep'|'client_manager'|'client_admin', store_codes: ['GAM-118', ...] }
// Provisions (or updates) a staff login and which of the tenant's stores
// they can see. Login itself no longer needs a stored code here — see
// auth-request-code.js/auth-login.js, which email a fresh one-time code to
// whatever address is on this record. This is the enforcement point for
// "staff only see what's been allocated to them" — a field_rep's session
// only ever includes stores present in this assignment list.

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
    return { statusCode: 200, body: JSON.stringify({ tenant_code: tenantCode, users }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (body.tenant_code || claims.scopedTenantCode);
  if (!tenantCode || !body.email || !Array.isArray(body.store_codes)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code, email and store_codes[] required' }) };
  }
  if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
  }

  const store = blobsStore(`users-${tenantCode}`);
  const users = (await store.get('list', { type: 'json' })) || [];
  const idx = users.findIndex(u => u.email.toLowerCase() === body.email.toLowerCase());
  const record = {
    email: body.email,
    role: body.role || 'field_rep',
    storeCodes: body.store_codes,
    // Preserve lastLoginAt across a re-assignment (e.g. adding more stores
    // to someone who's already logged in) rather than silently wiping it.
    ...(idx >= 0 && users[idx].lastLoginAt ? { lastLoginAt: users[idx].lastLoginAt } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) users[idx] = record; else users.push(record);
  await store.setJSON('list', users);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, user: record }) };
};
