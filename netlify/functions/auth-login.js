// POST /api/auth-login
//   { access_code }                        → monthly-code sign-in (view-only client viewer)
//   { company_code, email, password }      → normal tenant sign-in
//
// The tenant is always resolved server-side; the frontend never sends a tenant ID.
const { findTenantByCode, SUPER_ADMIN_EMAIL, CODE_HOLDERS } = require('./_data');
const accessCode = require('./_lib/accesscode');
const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { company_code, email, password, access_code } = body;

  // 1. Monthly access code — matched against every code holder's tenant.
  if (access_code && !company_code && !email) {
    const holder = CODE_HOLDERS.find(h => accessCode.verify(h.tenantCode, access_code));
    if (!holder) {
      return { statusCode: 401, body: JSON.stringify({ error: 'That code is not valid this month.' }) };
    }
    const tenant = findTenantByCode(holder.tenantCode);
    const token = jwt.sign({ role: holder.role, tenantId: tenant.id, tenantCode: tenant.code, email: holder.email });
    return {
      statusCode: 200,
      body: JSON.stringify({
        token, role: holder.role, viewerName: holder.name, readOnly: true,
        client: { code: tenant.code, name: tenant.name, logo: tenant.logoUrl },
      }),
    };
  }

  // 2. Leegra super admin.
  if ((email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
    const token = jwt.sign({ role: 'leegra_super_admin', email });
    return { statusCode: 200, body: JSON.stringify({ token, role: 'leegra_super_admin' }) };
  }

  // 3. Field rep against a company code.
  const tenant = findTenantByCode(company_code);
  if (!tenant) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid company code or credentials' }) };
  }
  const token = jwt.sign({ role: 'field_rep', tenantId: tenant.id, tenantCode: tenant.code });
  return {
    statusCode: 200,
    body: JSON.stringify({ token, role: 'field_rep', client: { code: tenant.code, name: tenant.name, logo: tenant.logoUrl } }),
  };
};
