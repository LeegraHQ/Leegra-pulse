// POST /api/visits  { store_id }  — starts a visit for the logged-in rep.
// PATCH /api/visits-task  { visit_id, type, payload } — upserts a task result.
// POST /api/visits-checkout  { visit_id } — closes a visit.
//
// These are stubbed to accept and echo back a timestamped record so the
// frontend flow is fully exercisable. Wire them to a real visits table
// (see BACKEND.md's schema) — every write must include the tenantId from
// the verified JWT (jwt.fromAuthHeader), never a client-supplied one.

const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  return {
    statusCode: 200,
    body: JSON.stringify({
      id: `visit_${Date.now()}`,
      tenant_id: claims.tenantId,
      store_id: body.store_id,
      checkin_at: new Date().toISOString(),
    }),
  };
};
