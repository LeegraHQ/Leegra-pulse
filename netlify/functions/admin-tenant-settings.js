// GET  /api/admin-tenant-settings?tenant_code=X   — read one tenant's settings
// POST /api/admin-tenant-settings { tenant_code, learning_enabled }
// Per-tenant feature flags — currently just whether Leegra Learning shows
// up for that client (defaults to true/on if never set). Auth: super_user
// or admin, or that tenant's own client_admin.

const jwt = require('./_lib/jwt');
const { LEEGRA_WRITE_ROLES } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');
const { getTenantSettings, saveTenantSettings } = require('./_lib/records');

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
    const settings = await getTenantSettings(tenantCode);
    return { statusCode: 200, body: JSON.stringify({ tenant_code: tenantCode, learningEnabled: settings.learningEnabled !== false }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (body.tenant_code || claims.scopedTenantCode);
  if (!tenantCode || typeof body.learning_enabled !== 'boolean') {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code and learning_enabled (bool) required' }) };
  }
  if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
  }

  const settings = await getTenantSettings(tenantCode);
  settings.learningEnabled = body.learning_enabled;
  await saveTenantSettings(tenantCode, settings);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, learningEnabled: settings.learningEnabled }) };
};
