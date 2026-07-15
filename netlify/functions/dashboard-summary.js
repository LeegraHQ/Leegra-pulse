// GET /api/dashboard-summary — tenant-scoped stats for the logged-in client.
// The tenant comes ONLY from the verified token, never from a query param —
// except for Leegra's own staff (any tier), who may pass ?tenant_code= to
// drill into one tenant's full dashboard (any other role's tenant_code
// param is ignored). All three staff tiers can read every tenant's
// dashboard — the tiers only differ on write access (see the admin-*
// endpoints), not on this read-only summary. A staff member can also be
// scoped to a single tenant (claims.scopedTenantCode, see _lib/scope.js) —
// for them, ?tenant_code= must match that tenant (or defaults to it), and
// the no-param "every tenant" list collapses to just their one tenant.

const jwt = require('./_lib/jwt');
const { TENANTS, findTenantByCode, LEEGRA_ROLES } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');
const { getStores, getAllVisits, computeDashboard, getTenantSettings } = require('./_lib/records');

async function tenantDashboard(tenant) {
  const [stores, visits] = await Promise.all([getStores(tenant.code), getAllVisits(tenant.code)]);
  return computeDashboard(stores, visits);
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  if (LEEGRA_ROLES.includes(claims.role)) {
    const tenantCode = event.queryStringParameters?.tenant_code || claims.scopedTenantCode;
    if (tenantCode) {
      if (!tenantScopeOk(claims, tenantCode)) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
      }
      const tenant = findTenantByCode(tenantCode);
      if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
      const [dashboard, settings] = await Promise.all([tenantDashboard(tenant), getTenantSettings(tenant.code)]);
      return {
        statusCode: 200,
        body: JSON.stringify({
          code: tenant.code, name: tenant.name, logo: tenant.logoUrl,
          learningEnabled: settings.learningEnabled !== false,
          ...dashboard,
        }),
      };
    }

    const tenants = await Promise.all(TENANTS.map(async t => {
      const { stores, leaderboard, ...metrics } = await tenantDashboard(t);
      return { ...t, ...metrics };
    }));
    return { statusCode: 200, body: JSON.stringify({ tenants }) };
  }

  const tenant = findTenantByCode(claims.tenantCode);
  if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
  const dashboard = await tenantDashboard(tenant);
  const stores = claims.role === 'field_rep'
    ? dashboard.stores.filter(s => (claims.storeCodes || []).includes(s.code))
    : dashboard.stores;

  return { statusCode: 200, body: JSON.stringify({ ...dashboard, stores }) };
};
