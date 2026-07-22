// GET /api/admin-login-status[?tenant_code=PH-201]
// Consolidated login-status roster across every tenant (or one, with
// ?tenant_code=) — every assigned client user (field_rep/client_manager/
// client_admin) with whether and when they last logged in, so Leegra staff
// can see who's actually gotten in without checking per-tenant or asking
// each person directly. Auth: Leegra staff only (any tier — this is a read,
// same as admin-visit-log.js). A scoped staff member (see _lib/scope.js)
// only ever sees their one tenant, same as everywhere else.

const jwt = require('./_lib/jwt');
const { TENANTS, LEEGRA_ROLES, findTenantByCode } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');
const { getUsers } = require('./_lib/records');

async function tenantLoginRows(tenant) {
  const users = await getUsers(tenant.code);
  return users.map(u => ({
    tenantCode: tenant.code,
    tenantName: tenant.name,
    email: u.email,
    role: u.role,
    lastLoginAt: u.lastLoginAt || null,
    hasFixedCode: !!u.fixedCode,
  }));
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (!LEEGRA_ROLES.includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  const tenantCodeParam = event.queryStringParameters?.tenant_code || claims.scopedTenantCode;

  let tenants = TENANTS;
  if (tenantCodeParam) {
    if (!tenantScopeOk(claims, tenantCodeParam)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
    }
    const tenant = findTenantByCode(tenantCodeParam);
    if (!tenant) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
    tenants = [tenant];
  } else if (claims.scopedTenantCode) {
    tenants = TENANTS.filter(t => t.code === claims.scopedTenantCode);
  }

  const perTenant = await Promise.all(tenants.map(tenantLoginRows));
  const rows = perTenant.flat().sort((a, b) => {
    // Never-logged-in first (the thing you're checking for), then most
    // recent login first within the rest.
    if (!a.lastLoginAt && b.lastLoginAt) return -1;
    if (a.lastLoginAt && !b.lastLoginAt) return 1;
    if (!a.lastLoginAt && !b.lastLoginAt) return a.tenantName.localeCompare(b.tenantName);
    return new Date(b.lastLoginAt) - new Date(a.lastLoginAt);
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      count: rows.length,
      loggedInCount: rows.filter(r => r.lastLoginAt).length,
      users: rows,
    }),
  };
};
