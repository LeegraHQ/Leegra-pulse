// GET  /api/photos?tenant=CIV-088[&month=2026-07][&store=TOT-4021]
//        → the gallery: newest first, each with its caption.
// POST /api/photos   { tenant, store_code, visit_date, caption, scope, filename, content_type, data_base64 }
//        → uploads the image to Supabase Storage and records it. Admin only.
// PATCH /api/photos  { id, caption }  → edit a caption. Admin only.
// DELETE /api/photos?id=<uuid>  → admin only.
//
// scope: 'visit' = before/after shots tied to a store visit
//        'month' = general gallery for the client's month
const jwt = require('./_lib/jwt');
const db = require('./_lib/supabase');

const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'visit-photos';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const user = jwt.fromAuthHeader(event);
  if (!user) return json(401, { error: 'Not signed in' });
  if (!db.configured()) return json(503, { error: 'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });

  const isAdmin = user.role === 'leegra_super_admin';
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    // Non-admins can only ever read their own tenant's photos.
    const tenant = isAdmin ? (q.tenant || '') : user.tenantCode;
    if (!tenant) return json(400, { error: 'tenant is required' });
    let query = '?select=*&tenant_code=eq.' + encodeURIComponent(tenant) + '&order=taken_at.desc';
    if (q.month) query += '&month=eq.' + encodeURIComponent(q.month);
    if (q.store) query += '&store_code=eq.' + encodeURIComponent(q.store);
    if (q.scope) query += '&scope=eq.' + encodeURIComponent(q.scope);
    try { return json(200, await db.select('visit_photos', query)); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  if (event.httpMethod === 'POST') {
    if (!isAdmin) return json(403, { error: 'Only a Leegra admin can upload photos.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const { tenant, store_code, visit_date, caption, scope, filename, content_type, data_base64 } = body;
    if (!tenant || !data_base64) return json(400, { error: 'tenant and data_base64 are required' });

    const buffer = Buffer.from(data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > 8 * 1024 * 1024) return json(413, { error: 'Image is larger than 8 MB.' });

    const safeName = String(filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const month = (visit_date || new Date().toISOString()).slice(0, 7);
    const path = tenant + '/' + month + '/' + Date.now() + '-' + safeName;

    try {
      const url = await db.uploadToBucket(BUCKET, path, buffer, content_type || 'image/jpeg');
      const row = await db.insert('visit_photos', {
        tenant_code: tenant,
        store_code: store_code || null,
        scope: scope === 'month' ? 'month' : 'visit',
        month,
        caption: caption || null,
        url,
        storage_path: path,
        taken_at: visit_date ? new Date(visit_date).toISOString() : new Date().toISOString(),
        uploaded_by: user.email || 'admin',
      });
      return json(200, row);
    } catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  if (event.httpMethod === 'PATCH') {
    if (!isAdmin) return json(403, { error: 'Only a Leegra admin can edit captions.' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    if (!body.id) return json(400, { error: 'id is required' });
    try {
      await db.patch('visit_photos', '?id=eq.' + encodeURIComponent(body.id), { caption: body.caption || null });
      return json(200, { ok: true });
    } catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  if (event.httpMethod === 'DELETE') {
    if (!isAdmin) return json(403, { error: 'Only a Leegra admin can delete photos.' });
    if (!q.id) return json(400, { error: 'id is required' });
    try { await db.remove('visit_photos', '?id=eq.' + encodeURIComponent(q.id)); return json(200, { ok: true }); }
    catch (e) { return json(500, { error: String(e.message || e) }); }
  }

  return json(405, { error: 'Method not allowed' });
};
