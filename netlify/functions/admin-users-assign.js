// POST /api/admin-users-assign
// Body: { email, role: 'field_rep'|'client_manager'|'client_admin', store_codes: ['GAM-118', ...] }
// Provisions (or updates) a staff login and which of the tenant's stores
// they can see. This is the enforcement point for "staff only see what's
// been allocated to them" — a field_rep's /my/stores call (see
// dashboard-summary.js / a future my-stores.js) should only ever return
// stores present in this assignment list.

const jwt = require('./_lib/jwt');
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!['leegra_super_admin', 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : body.tenant_code;
  if (!tenantCode || !body.email || !Array.isArray(body.store_codes)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code, email and store_codes[] required' }) };
  }

  const store = getStore(`users-${tenantCode}`);
  const users = (await store.get('list', { type: 'json' })) || [];
  const idx = users.findIndex(u => u.email.toLowerCase() === body.email.toLowerCase());
  const record = { email: body.email, role: body.role || 'field_rep', storeCodes: body.store_codes, updatedAt: new Date().toISOString() };
  if (idx >= 0) users[idx] = record; else users.push(record);
  await store.setJSON('list', users);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, user: record }) };
};
