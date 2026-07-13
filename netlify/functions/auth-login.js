// POST /api/auth-login  { email, code }
// The client never says which company or role it's logging into — the
// email is resolved server-side (see _lib/identity.js) and the one-time
// code from auth-request-code.js is checked here. There's no separate
// password/company-code field: possession of the emailed code plus that
// exact email is the whole login.

const { TIER_TO_ROLE } = require('./_data');
const jwt = require('./_lib/jwt');
const { resolveIdentityByEmail } = require('./_lib/identity');
const { getOtp, clearOtp, getStores, getAllVisits, computeDashboard, getTenantSettings } = require('./_lib/records');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const normalizedEmail = (body.email || '').trim().toLowerCase();
  const submittedCode = (body.code || '').trim();
  if (!normalizedEmail || !submittedCode) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  const otp = await getOtp(normalizedEmail);
  if (!otp || otp.code !== submittedCode || Date.now() > otp.expiresAt) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }
  await clearOtp(normalizedEmail); // one-time use

  const identity = await resolveIdentityByEmail(normalizedEmail);
  if (!identity) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  if (identity.kind === 'super_admin') {
    const token = jwt.sign({ role: 'leegra_super_admin', email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role: 'leegra_super_admin', email: normalizedEmail }) };
  }

  if (identity.kind === 'staff') {
    const role = TIER_TO_ROLE[identity.staffRecord.tier] || 'leegra_report_only';
    const token = jwt.sign({ role, email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role, email: normalizedEmail }) };
  }

  const { tenant, userRecord } = identity;
  const role = userRecord.role || 'field_rep';
  const storeCodes = userRecord.storeCodes || [];

  const [stores, visits, settings] = await Promise.all([
    getStores(tenant.code),
    getAllVisits(tenant.code),
    getTenantSettings(tenant.code),
  ]);
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
        learningEnabled: settings.learningEnabled !== false,
      },
    }),
  };
};
