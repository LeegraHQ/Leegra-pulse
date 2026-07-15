// GET  /api/admin-staff-assign               — list Leegra's internal staff roster
// POST /api/admin-staff-assign  { email, name, tier, tenant_code? }  — add or update a staff member
// tier: 'super_user' | 'admin' | 'report_export_only'
// tenant_code (optional): restricts this staff member to that one tenant
// only, regardless of tier — omit/clear it to restore normal cross-tenant
// access. Useful for someone who sits on the Leegra roster but should only
// ever see one client's data (e.g. a dedicated account manager).
//
// This is the one action even the 'admin' tier can't do — only a super_user
// can grant or change anyone's cross-tenant access, so a compromised or
// careless admin account can't hand out more access than it has itself.

const jwt = require('./_lib/jwt');
const { TIER_TO_ROLE, findTenantByCode } = require('./_data');
const { getStaff, saveStaff } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (claims.role !== 'leegra_super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only a super user can manage staff access' }) };
  }

  if (event.httpMethod === 'GET') {
    const staff = await getStaff();
    return { statusCode: 200, body: JSON.stringify({ staff }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.email || !TIER_TO_ROLE[body.tier]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email and a valid tier (super_user, admin, report_export_only) required' }) };
  }

  let scopedTenantCode = null;
  if (body.tenant_code) {
    const tenant = findTenantByCode(body.tenant_code);
    if (!tenant) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown tenant_code' }) };
    scopedTenantCode = tenant.code;
  }

  const email = body.email.trim().toLowerCase();
  const staff = await getStaff();
  const record = { email, name: body.name || '', tier: body.tier, scopedTenantCode, updatedAt: new Date().toISOString() };
  const idx = staff.findIndex(s => s.email === email);
  if (idx >= 0) staff[idx] = record; else staff.push(record);
  await saveStaff(staff);

  return { statusCode: 200, body: JSON.stringify({ ok: true, staff: record }) };
};
