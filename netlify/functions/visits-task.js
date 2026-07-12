const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'PATCH') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  return { statusCode: 200, body: JSON.stringify({ ok: true, visit_id: body.visit_id, type: body.type, saved_at: new Date().toISOString() }) };
};
