// POST /api/visit-photo  { visit_id, question_id, image_base64, mime, taken_at?, source? }
//   — attaches a photo to one of the caller's own in-progress visit's
//   'photo'-type questions. The app has already burned the date/time stamp
//   into the image. Stored in Supabase Storage (see _lib/records.js).
//   Auth: the field_rep who owns the visit.
// GET  /api/visit-photo?tenant_code=X&photo_id=Y
//   — serves the raw image bytes. Auth: Leegra staff (any tier), or a
//   client_admin/client_manager of that same tenant.

const jwt = require('./_lib/jwt');
const { LEEGRA_ROLES } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');
const { getLiveVisit, saveLiveVisit, savePhoto, getPhoto } = require('./_lib/records');

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return json(401, { error: 'Not authenticated' });

  if (event.httpMethod === 'GET') {
    const tenantCode = event.queryStringParameters?.tenant_code;
    const photoId = event.queryStringParameters?.photo_id;
    if (!tenantCode || !photoId) return json(400, { error: 'tenant_code and photo_id required' });
    const allowed = (LEEGRA_ROLES.includes(claims.role) && tenantScopeOk(claims, tenantCode)) || claims.tenantCode === tenantCode;
    if (!allowed) return json(403, { error: 'Not permitted' });

    const photo = await getPhoto(tenantCode, photoId);
    if (!photo) return json(404, { error: 'Photo not found' });
    return {
      statusCode: 200,
      headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=86400' },
      isBase64Encoded: true,
      body: Buffer.from(photo.bytes).toString('base64'),
    };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { visit_id, question_id, image_base64, mime, taken_at, source } = body;
  if (!visit_id || !question_id || !image_base64) return json(400, { error: 'visit_id, question_id and image_base64 required' });

  const visit = await getLiveVisit(claims.tenantCode, visit_id);
  if (!visit || visit.repEmail !== claims.email) return json(404, { error: 'Visit not found' });

  const photoId = `${visit_id}_${question_id}`;
  const bytes = Buffer.from(image_base64, 'base64');
  if (bytes.length > 5 * 1024 * 1024) return json(413, { error: 'Photo is too large' });

  let storedIn;
  try {
    storedIn = await savePhoto(claims.tenantCode, photoId, bytes, mime || 'image/jpeg');
  } catch (e) {
    return json(500, { error: 'Photo storage failed: ' + String(e.message || e).slice(0, 160) });
  }

  visit.answers = visit.answers || {};
  visit.answers[question_id] = {
    photoId,
    takenAt: taken_at || new Date().toISOString(),
    uploadedAt: new Date().toISOString(),
    source: source === 'gallery' ? 'gallery' : 'camera',
  };
  await saveLiveVisit(claims.tenantCode, visit);

  return json(200, { ok: true, photo_id: photoId, stored_in: storedIn });
};
