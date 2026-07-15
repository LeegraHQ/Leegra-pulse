// A Leegra staff member normally sees every tenant, regardless of tier —
// but a staff record can optionally carry a scopedTenantCode (set via
// admin-staff-assign.js), restricting that one person to a single client's
// data no matter which tier they hold. auth-login.js copies this onto the
// JWT as claims.scopedTenantCode; every admin-*/dashboard endpoint that
// lets Leegra staff pass an arbitrary tenant_code must check this before
// acting on it.
function tenantScopeOk(claims, tenantCode) {
  return !claims.scopedTenantCode || claims.scopedTenantCode === tenantCode;
}

module.exports = { tenantScopeOk };
