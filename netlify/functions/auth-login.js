// POST /api/auth-login  { company_code, email, password }
// Resolves the tenant server-side from company_code — the frontend never
// sends or trusts a tenant/client ID directly. Role and store access come
// from whatever admin-users-assign has stored for this email, never from the
// login request. Password isn't checked yet — there's no password storage
// in this Blobs-backed setup; add real hashing once you're past the demo.

const { findTenantByCode, SUPER_ADMIN_EMAIL, TIER_TO_ROLE } = require('./_data');
const jwt = require('./_lib/jwt');
const { getStores, getUsers, getAllVisits, computeDashboard, getStaff } = require('./_lib/records');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { company_code, email } = body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (normalizedEmail === SUPER_ADMIN_EMAIL) {
    const token = jwt.sign({ role: 'leegra_super_admin', email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role: 'leegra_super_admin', email: normalizedEmail }) };
  }

  const staff = await getStaff();
  const staffRecord = staff.find(s => s.email === normalizedEmail);
  if (staffRecord) {
    const role = TIER_TO_ROLE[staffRecord.tier] || 'leegra_report_only';
    const token = jwt.sign({ role, email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role, email: normalizedEmail }) };
  }

  const tenant = findTenantByCode(company_code);
  if (!tenant) {
    // Generic error — never reveal whether the code or the password was wrong.
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid company code or credentials' }) };
  }

  const users = await getUsers(tenant.code);
  const userRecord = users.find(u => u.email.toLowerCase() === normalizedEmail);
  const role = userRecord?.role || 'field_rep';
  const storeCodes = userRecord?.storeCodes || [];

  const [stores, visits] = await Promise.all([getStores(tenant.code), getAllVisits(tenant.code)]);
  const dashboard = computeDashboard(stores, visits);
  const visibleStores = role === 'field_rep'
    ? dashboard.stores.filter(s => storeCodes.includes(s.code))
    : dashboard.stores;

  const token = jwt.sign({ role, tenantId: tenant.id, tenantCode: tenant.code, email: normalizedEmail, storeCodes });

  return {
    statusCode: 200,
    body: JSON.stringify({
      token,
      role,
      client: {
        code: tenant.code,
        name: tenant.name,
        logo: tenant.logoUrl,
        staffName: normalizedEmail.split('@')[0],
        staffEmail: normalizedEmail,
        repStoreCount: visibleStores.length,
        compliance: dashboard.compliance,
        completedPlanned: dashboard.completedPlanned,
        storesCovered: dashboard.storesCovered,
        oosIssues: dashboard.oosIssues,
        stores: visibleStores,
        leaderboard: dashboard.leaderboard,
      },
    }),
  };
};
