// PATCH /api/visits-task  { visit_id, question_id, answer } — saves the
// rep's answer to one question on their own in-progress visit. `answer`'s
// shape depends on the question's type (boolean, number, text, choice) —
// this endpoint doesn't validate it against the type, only that the visit
// belongs to the caller.

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

  visit.answers[body.question_id] = body.answer;
  await saveLiveVisit(claims.tenantCode, visit);

  return { statusCode: 200, body: JSON.stringify({ ok: true, visit_id: body.visit_id, question_id: body.question_id, saved_at: new Date().toISOString() }) };
};
