// GET   /api/metrics?tenant=CIV-088&month=2026-07  → the month's headline numbers
// PATCH /api/metrics  { tenant, month, calls_completed, calls_planned, stores_covered, avg_rating, note }
//         → Leegra admin only. Upserted on (tenant_code, month), so editing the
//           same month twice overwrites rather than duplicating.
const jwt = require('./_lib/jwt');
const db = require('./_lib/supabase');

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const user = jwt.fromAuthHeader(event);
  if (!user) return json(401, { error: 'Not signed in' });
  if (!db.configured()) return json(503, { error: 'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });

  const isAdmin = user.role === 'leegra_super_admin';
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const tenant = isAdmin ? (q.tenant || '') : user.tenantCode;
    if (!tenant) return json(400, { error: 'tenant is required' });
    let query = '?select=*&tenant_code=eq.' + encodeURIComponent(tenant) + '&order=month.desc';
    if (q.month) query += '&month=eq.' + encodeURIComponent(q.month);
    try { return json(200, await db.select('client_month_metrics', query)); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
    if (!isAdmin) return json(403, { error: 'Only a Leegra admin can change these numbers.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const { tenant, month } = body;
    if (!tenant || !month) return json(400, { error: 'tenant and month (YYYY-MM) are required' });

    const row = {
      tenant_code: tenant,
      month,
      calls_completed: body.calls_completed ?? null,
      calls_planned: body.calls_planned ?? null,
      stores_covered: body.stores_covered ?? null,
      avg_rating: body.avg_rating ?? null,
      note: body.note || null,
      updated_at: new Date().toISOString(),
      updated_by: user.email || 'admin',
    };
    try { return json(200, await db.upsert('client_month_metrics', row, 'tenant_code,month')); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  return json(405, { error: 'Method not allowed' });
};
