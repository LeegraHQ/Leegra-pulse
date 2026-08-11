// POST /api/auth-login
//   { access_code }                  → monthly-code sign-in (read-only client viewer)
//   { email, code, tenant_code? }    → the normal email + OTP / fixed-code sign-in
//
// The client never says which company or role it's logging into — the
// email is resolved server-side (see _lib/identity.js) first, then the
// submitted code is checked against whichever credential applies to that
// person:
//   - Leegra staff / super-admin: always the emailed OTP (auth-request-code.js).
//   - A tenant user (field_rep/client_manager/client_admin) with a fixedCode
//     set on their record (see admin-users-assign.js's reset_code action):
//     that persistent code, instead of the emailed OTP. This exists for
//     people who reliably don't receive the OTP email — Leegra sets a fixed
//     code for them once and relays it out of band (phone/WhatsApp); it
//     never expires on its own and only changes when explicitly reset.
//   - Everyone else: the emailed one-time code, as before.
// One more exception: TEST_REP_EMAIL, which logs in with a fixed
// TEST_REP_PERMANENT_CODE (see below), and which admin-users-assign can
// attach to every tenant for demos — for that one account only, identity
// resolves to 'multi_tenant_user' and this returns
// { needsTenantChoice: true, tenants: [...] } until the caller resubmits
// with tenant_code set to one of them (that path stays OTP/fixed-test-code
// only — a multi-tenant login doesn't have a single user record to hold a
// fixedCode until a tenant is chosen).

const { TIER_TO_ROLE, CODE_HOLDERS, findTenantByCode } = require('./_data');
const jwt = require('./_lib/jwt');
const accessCode = require('./_lib/accesscode');
const { resolveIdentityByEmail } = require('./_lib/identity');
const { getOtp, clearOtp, getStores, getAllVisits, computeDashboard, getTenantSettings, recordUserLogin } = require('./_lib/records');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  // --- Monthly access code: a code on its own, no email. -------------------
  // Checked before anything else so it never touches the OTP path.
  const suppliedAccessCode = (body.access_code || '').trim();
  if (suppliedAccessCode && !body.email) {
    // verify() is identity-blind (one shared code), so the holder is chosen by
    // WHICH code was typed: the admin code -> the Leegra staff entry, the
    // shared code -> the read-only client viewer.
    const wantsAdmin = accessCode.isAdminCode(suppliedAccessCode);
    const holder = wantsAdmin
      ? CODE_HOLDERS.find(h => h.role.startsWith('leegra_'))
      : CODE_HOLDERS.find(h => !h.role.startsWith('leegra_') && accessCode.verify(h.tenantCode, suppliedAccessCode));
    if (!holder) {
      return { statusCode: 401, body: JSON.stringify({ error: 'That code is not valid this month.' }) };
    }
    const tenant = findTenantByCode(holder.tenantCode);
    const isLeegraStaff = holder.role.startsWith('leegra_');
    // Staff get an unscoped token (every tenant); a client viewer is pinned
    // to their one tenant and is read-only.
    const claims = isLeegraStaff
      ? { role: holder.role, email: holder.email }
      : { role: holder.role, tenantId: tenant.id, tenantCode: tenant.code, email: holder.email };
    const token = jwt.sign(claims);
    return {
      statusCode: 200,
      body: JSON.stringify({
        token, role: holder.role, viewerName: holder.name, readOnly: !isLeegraStaff,
        client: { code: tenant.code, name: tenant.name, logo: tenant.logoUrl },
      }),
    };
  }

  const normalizedEmail = (body.email || '').trim().toLowerCase();
  const submittedCode = (body.code || '').trim();
  const tenantCodeChoice = (body.tenant_code || '').trim().toUpperCase();
  if (!normalizedEmail || !submittedCode) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  // One test/demo account (set via env, not hardcoded) can use a fixed code
  // instead of an emailed one-time code, so it doesn't need email access
  // during live demos.
  // A code holder can sign in through the app's normal email box too: their
  // email plus the current access code, no OTP. Same code as the Civvio
  // report page, so Alys has one code for both.
  const holder = CODE_HOLDERS.find(h => h.email.toLowerCase() === normalizedEmail);
  // Staff need the admin code; a client viewer needs the shared one.
  const isHolderCodeLogin = !!holder && (holder.role.startsWith('leegra_')
    ? accessCode.isAdminCode(submittedCode)
    : accessCode.verify(holder.tenantCode, submittedCode));

  const isTestRepLogin = process.env.TEST_REP_EMAIL
    && process.env.TEST_REP_PERMANENT_CODE
    && normalizedEmail === process.env.TEST_REP_EMAIL.trim().toLowerCase()
    && submittedCode === process.env.TEST_REP_PERMANENT_CODE;

  let identity = await resolveIdentityByEmail(normalizedEmail);

  // A code holder doesn't need a user record on the tenant — the holder entry
  // in _data.js is the record.
  if (!identity && isHolderCodeLogin) {
    identity = {
      kind: 'tenant_user',
      tenant: findTenantByCode(holder.tenantCode),
      userRecord: { role: holder.role, storeCodes: [], fixedCode: null },
    };
  }

  if (!identity) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
  }

  // A tenant user's fixedCode (if set) is checked here, before falling back
  // to OTP — it's persistent, so unlike the OTP it's never cleared on use.
  const fixedCode = identity.kind === 'tenant_user' ? identity.userRecord.fixedCode : null;
  const isFixedCodeLogin = fixedCode && submittedCode === fixedCode;

  if (!isTestRepLogin && !isFixedCodeLogin && !isHolderCodeLogin) {
    const otp = await getOtp(normalizedEmail);
    if (!otp || otp.code !== submittedCode || Date.now() > otp.expiresAt) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
    }
    await clearOtp(normalizedEmail); // one-time use
  }

  if (isHolderCodeLogin && holder.role.startsWith('leegra_')) {
    const token = jwt.sign({ role: holder.role, email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role: holder.role, email: normalizedEmail }) };
  }

  if (identity.kind === 'super_admin') {
    const token = jwt.sign({ role: 'leegra_super_admin', email: normalizedEmail });
    return { statusCode: 200, body: JSON.stringify({ token, role: 'leegra_super_admin', email: normalizedEmail }) };
  }

  if (identity.kind === 'staff') {
    const role = TIER_TO_ROLE[identity.staffRecord.tier] || 'leegra_report_only';
    const scopedTenantCode = identity.staffRecord.scopedTenantCode || null;
    const token = jwt.sign({ role, email: normalizedEmail, scopedTenantCode });
    return { statusCode: 200, body: JSON.stringify({ token, role, email: normalizedEmail, scopedTenantCode }) };
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
    recordUserLogin(tenant.code, normalizedEmail),
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
