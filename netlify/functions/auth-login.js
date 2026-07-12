// POST /api/auth-login  { company_code, email, password }
// Resolves the tenant server-side from company_code — the frontend never
// sends or trusts a tenant/client ID directly. Replace the password check
// with a real lookup (e.g. bcrypt against a users table) once a DB is wired
// up; this demo accepts any password for a matched tenant so it's runnable
// with zero setup.

const { findTenantByCode, SUPER_ADMIN_EMAIL } = require('./_data');
const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { company_code, email } = body;

  if ((email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
    const token = jwt.sign({ role: 'leegra_super_admin', email });
    return { statusCode: 200, body: JSON.stringify({ token, role: 'leegra_super_admin' }) };
  }

  const tenant = findTenantByCode(company_code);
  if (!tenant) {
    // Generic error — never reveal whether the code or the password was wrong.
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid company code or credentials' }) };
  }

  const token = jwt.sign({ role: 'field_rep', tenantId: tenant.id, tenantCode: tenant.code });
  return {
    statusCode: 200,
    body: JSON.stringify({ token, role: 'field_rep', client: { code: tenant.code, name: tenant.name, logo: tenant.logoUrl } }),
  };
};
