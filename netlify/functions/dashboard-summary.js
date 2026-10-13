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
//
// The all-clients list loads each tenant independently with a time cap, so
// one heavy or broken tenant can no longer fail the whole staff sign-in —
// that tenant just shows without metrics.

const jwt = require('./_lib/jwt');
const { TENANTS, findTenantByCode, LEEGRA_ROLES, SUPER_ADMIN_EMAIL } = require('./_data');

// Hatfield and Tower are visible to Chris alone — filtered out of the
// all-clients list, and refused on a direct drill-in, for everyone else.
const RESTRICTED_TENANT_CODES = ['HAT-009', 'TWR-260'];
const isSuperAdminEmail = claims => String(claims.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
const { tenantScopeOk } = require('./_lib/scope');
const { getStores, getAllVisits, computeDashboard, getTenantSettings } = require('./_lib/records');

const PER_TENANT_MS = 6000;
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

async function tenantDashboard(tenant) {
  const [stores, visits] = await Promise.all([getStores(tenant.code), getAllVisits(tenant.code)]);
  return computeDashboard(stores, visits);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return json(401, { error: 'Not authenticated' });

  try {
    if (LEEGRA_ROLES.includes(claims.role)) {
      const tenantCode = event.queryStringParameters?.tenant_code || claims.scopedTenantCode;
      if (tenantCode) {
        if (!tenantScopeOk(claims, tenantCode)) return json(403, { error: 'Not permitted for that tenant' });
        const tenant = findTenantByCode(tenantCode);
        if (!tenant) return json(404, { error: 'Unknown tenant' });
        if (RESTRICTED_TENANT_CODES.includes(tenant.code) && !isSuperAdminEmail(claims)) {
          return json(403, { error: 'Not permitted for that tenant' });
        }
        const [dashboard, settings] = await Promise.all([tenantDashboard(tenant), getTenantSettings(tenant.code)]);
        return json(200, {
          code: tenant.code, name: tenant.name, logo: tenant.logoUrl,
          learningEnabled: settings.learningEnabled !== false,
          ...dashboard,
        });
      }

      const visibleTenants = isSuperAdminEmail(claims)
        ? TENANTS
        : TENANTS.filter(t => !RESTRICTED_TENANT_CODES.includes(t.code));
      const tenants = await Promise.all(visibleTenants.map(async t => {
        try {
          const { stores, leaderboard, ...metrics } = await withTimeout(tenantDashboard(t), PER_TENANT_MS);
          return { ...t, ...metrics };
        } catch (err) {
          console.error('dashboard-summary tenant failed', t.code, err && err.message);
          return { ...t, metricsUnavailable: true };
        }
      }));
      return json(200, { tenants });
    }

    const tenant = findTenantByCode(claims.tenantCode);
    if (!tenant) return json(404, { error: 'Unknown tenant' });
    const dashboard = await tenantDashboard(tenant);
    const stores = claims.role === 'field_rep'
      ? dashboard.stores.filter(s => (claims.storeCodes || []).includes(s.code))
      : dashboard.stores;
    return json(200, { ...dashboard, stores });
  } catch (err) {
    console.error('dashboard-summary failed', err && err.stack);
    return json(500, { error: 'Dashboard error: ' + (err && err.message) });
  }
};
