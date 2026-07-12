// GET /api/dashboard-summary — tenant-scoped stats for the logged-in client.
// The tenant comes ONLY from the verified token, never from a query param —
// except for leegra_super_admin, who may pass ?tenant_code= to drill into
// one tenant's full dashboard (any other role's tenant_code param is ignored).

const jwt = require('./_lib/jwt');
const { TENANTS, findTenantByCode } = require('./_data');
const { getStores, getAllVisits, computeDashboard } = require('./_lib/records');

async function tenantDashboard(tenant) {
  const [stores, visits] = await Promise.all([getStores(tenant.code), getAllVisits(tenant.code)]);
  return computeDashboard(stores, visits);
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  if (claims.role === 'leegra_super_admin') {
    const tenantCode = event.queryStringParameters?.tenant_code;
    if (tenantCode) {
      const tenant = findTenantByCode(tenantCode);
      if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
      const dashboard = await tenantDashboard(tenant);
      return { statusCode: 200, body: JSON.stringify({ code: tenant.code, name: tenant.name, logo: tenant.logoUrl, ...dashboard }) };
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
