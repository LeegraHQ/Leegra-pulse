// PATCH /api/visits-task  { visit_id, type, payload } — upserts a task result
// on the rep's own in-progress visit.

const jwt = require('./_lib/jwt');
const { getLiveVisit, saveLiveVisit } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'PATCH') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const visit = await getLiveVisit(claims.tenantCode, body.visit_id);
  if (!visit || visit.repEmail !== claims.email) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Visit not found' }) };
  }

  visit.tasks[body.type] = body.payload;
  await saveLiveVisit(claims.tenantCode, visit);

  return { statusCode: 200, body: JSON.stringify({ ok: true, visit_id: body.visit_id, type: body.type, saved_at: new Date().toISOString() }) };
};
