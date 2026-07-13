// Resolves a login email to whichever account it belongs to, without the
// client ever telling us which tenant to look in — the frontend no longer
// asks a person to pick their company, so this is the one place that scan
// happens. Cheap enough at 8 tenants; revisit if that number grows a lot.

const { TENANTS, SUPER_ADMIN_EMAIL } = require('../_data');
const { getStaff, getUsers } = require('./records');

async function resolveIdentityByEmail(normalizedEmail) {
  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    return { kind: 'super_admin' };
  }

  const staff = await getStaff();
  const staffRecord = staff.find(s => s.email === normalizedEmail);
  if (staffRecord) {
    return { kind: 'staff', staffRecord };
  }

  const perTenant = await Promise.all(TENANTS.map(async tenant => {
    const users = await getUsers(tenant.code);
    const userRecord = users.find(u => u.email.toLowerCase() === normalizedEmail);
    return userRecord ? { tenant, userRecord } : null;
  }));
  const match = perTenant.find(Boolean);
  if (match) {
    return { kind: 'tenant_user', tenant: match.tenant, userRecord: match.userRecord };
  }

  return null;
}

module.exports = { resolveIdentityByEmail };
