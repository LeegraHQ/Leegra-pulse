// POST /api/visit-photo  { visit_id, question_id, image_base64, mime }
//   — attaches a photo to one of the caller's own in-progress visit's
//   'photo'-type questions. Auth: the field_rep who owns the visit.
// GET  /api/visit-photo?tenant_code=X&photo_id=Y
//   — serves the raw image bytes. Auth: Leegra staff (any tier), or a
//   client_admin/client_manager of that same tenant.

const jwt = require('./_lib/jwt');
const { LEEGRA_ROLES } = require('./_data');
const { getLiveVisit, saveLiveVisit, savePhoto, getPhoto } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  if (event.httpMethod === 'GET') {
    const tenantCode = event.queryStringParameters?.tenant_code;
    const photoId = event.queryStringParameters?.photo_id;
    if (!tenantCode || !photoId) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code and photo_id required' }) };
    const allowed = LEEGRA_ROLES.includes(claims.role) || claims.tenantCode === tenantCode;
    if (!allowed) return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };

    const photo = await getPhoto(tenantCode, photoId);
    if (!photo) return { statusCode: 404, body: JSON.stringify({ error: 'Photo not found' }) };
    return {
      statusCode: 200,
      headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=86400' },
      isBase64Encoded: true,
      body: Buffer.from(photo.bytes).toString('base64'),
    };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { visit_id, question_id, image_base64, mime } = body;
  if (!visit_id || !question_id || !image_base64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'visit_id, question_id and image_base64 required' }) };
  }

  const visit = await getLiveVisit(claims.tenantCode, visit_id);
  if (!visit || visit.repEmail !== claims.email) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Visit not found' }) };
  }

  const photoId = `${visit_id}_${question_id}`;
  const bytes = Buffer.from(image_base64, 'base64');
  await savePhoto(claims.tenantCode, photoId, bytes, mime || 'image/jpeg');

  visit.answers[question_id] = { photoId };
  await saveLiveVisit(claims.tenantCode, visit);

  return { statusCode: 200, body: JSON.stringify({ ok: true, photo_id: photoId }) };
};
