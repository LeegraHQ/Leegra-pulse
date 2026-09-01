// Resolves a login email to whichever account it belongs to, without the
// client ever telling us which tenant to look in — the frontend no longer
// asks a person to pick their company, so this is the one place that scan
// happens. Cheap enough at 8 tenants; revisit if that number grows a lot.
//
// A real client user is only ever assigned to one tenant, so this resolves
// straight to it. The one deliberate exception is the shared test/demo
// account (see TEST_REP_EMAIL in auth-login.js), which admin-users-assign
// can add to every tenant for demo purposes — for that email only, this
// returns 'multi_tenant_user' and auth-login asks which tenant to enter.

const { TENANTS, SUPER_ADMIN_EMAIL } = require('../_data');
const { getStaff, getUsers } = require('./records');

// opts.preferTenantUser: skip the staff/super-admin short-circuits and look
// only for a tenant user record. Leegra staff who also hold a field-rep record
// (Chris, for testing the rep app) resolve to STAFF by default — this is how
// auth-login asks for the rep side of the same email instead. Returns null when
// there is no tenant record, so a caller can never silently fall back to
// staff rights it didn't ask for.
async function resolveIdentityByEmail(normalizedEmail, opts) {
  const preferTenantUser = !!(opts && opts.preferTenantUser);

  if (!preferTenantUser) {
    if (normalizedEmail === SUPER_ADMIN_EMAIL) {
      return { kind: 'super_admin' };
    }

    const staff = await getStaff();
    const staffRecord = staff.find(s => s.email === normalizedEmail);
    if (staffRecord) {
      return { kind: 'staff', staffRecord };
    }
  }

  const perTenant = await Promise.all(TENANTS.map(async tenant => {
    const users = await getUsers(tenant.code);
    const userRecord = users.find(u => u.email.toLowerCase() === normalizedEmail);
    return userRecord ? { tenant, userRecord } : null;
  }));
  const matches = perTenant.filter(Boolean);
  if (matches.length === 1) {
    return { kind: 'tenant_user', tenant: matches[0].tenant, userRecord: matches[0].userRecord };
  }
  if (matches.length > 1) {
    return { kind: 'multi_tenant_user', matches };
  }

  return null;
}

module.exports = { resolveIdentityByEmail };
