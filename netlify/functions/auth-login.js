// POST /api/auth-login  { email, code, tenant_code? }
// The client never says which company or role it's logging into — the
// email is resolved server-side (see _lib/identity.js) and the one-time
// code from auth-request-code.js is checked here. There's no separate
// password/company-code field: possession of the emailed code plus that
// exact email is the whole login. One exception: TEST_REP_EMAIL, which
// logs in with a fixed TEST_REP_PERMANENT_CODE instead (see below), and
// which admin-users-assign can attach to every tenant for demos — for that
// one account only, identity resolves to 'multi_tenant_user' and this
// returns { needsTenantChoice: true, tenants: [...] } until the caller
// resubmits with tenant_code set to one of them.

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
  const tenantCodeChoice = (body.tenant_code || '').trim().toUpperCase();
  if (!normalizedEmail || !submittedCode) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  // One test/demo account (set via env, not hardcoded) can use a fixed code
  // instead of an emailed one-time code, so it doesn't need email access
  // during live demos. Every other login still requires the emailed OTP.
  const isTestRepLogin = process.env.TEST_REP_EMAIL
    && process.env.TEST_REP_PERMANENT_CODE
    && normalizedEmail === process.env.TEST_REP_EMAIL.trim().toLowerCase()
    && submittedCode === process.env.TEST_REP_PERMANENT_CODE;

  if (!isTestRepLogin) {
    const otp = await getOtp(normalizedEmail);
    if (!otp || otp.code !== submittedCode || Date.now() > otp.expiresAt) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
    }
    await clearOtp(normalizedEmail); // one-time use
  }

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

  if (identity.kind === 'multi_tenant_user') {
    if (!tenantCodeChoice) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          needsTenantChoice: true,
          tenants: identity.matches.map(m => ({ code: m.tenant.code, name: m.tenant.name, logo: m.tenant.logoUrl })),
        }),
      };
    }
    const chosen = identity.matches.find(m => m.tenant.code === tenantCodeChoice);
    if (!chosen) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Not assigned to that client' }) };
    }
    identity.tenant = chosen.tenant;
    identity.userRecord = chosen.userRecord;
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
