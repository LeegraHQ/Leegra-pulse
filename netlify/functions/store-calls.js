// GET   /api/store-calls?tenant=CIV-088&month=2026-07 → admin edits layered over the import
// PATCH /api/store-calls  { tenant, month, store, status, calls_achieved, date_completed_1, rating }
//         → Leegra admin only. One row per (tenant, month, store); re-editing
//           the same store overwrites rather than duplicating.
//
// The imported spreadsheet stays the baseline; this table only holds what an
// admin changed by hand, so a re-import never loses those corrections and a
// correction never has to be re-typed after a re-import.
const jwt = require('./_lib/jwt');
const db = require('./_lib/supabase');

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const user = jwt.fromAuthHeader(event);
  if (!user) return json(401, { error: 'Not signed in' });
  if (!db.configured()) return json(503, { error: 'Supabase is not configured.' });

  const isAdmin = user.role === 'leegra_super_admin';
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const tenant = isAdmin ? (q.tenant || '') : user.tenantCode;
    if (!tenant) return json(400, { error: 'tenant is required' });
    let query = '?select=*&tenant_code=eq.' + encodeURIComponent(tenant);
    if (q.month) query += '&month=eq.' + encodeURIComponent(q.month);
    try { return json(200, await db.select('store_call_updates', query)); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
    if (!isAdmin) return json(403, { error: 'Only a Leegra admin can change store calls.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const { tenant, month, store } = body;
    if (!tenant || !month || !store) return json(400, { error: 'tenant, month and store are required' });

    const row = {
      tenant_code: tenant, month, store,
      status: body.status || null,
      calls_achieved: body.calls_achieved ?? null,
      date_completed_1: body.date_completed_1 || null,
      date_completed_2: body.date_completed_2 || null,
      rating: body.rating ?? null,
      updated_at: new Date().toISOString(),
      updated_by: user.email || 'admin',
    };
    try { return json(200, await db.upsert('store_call_updates', row, 'tenant_code,month,store')); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  return json(405, { error: 'Method not allowed' });
};
