// POST /api/visits  { store_id }  — starts a visit for the logged-in rep.
// Persists to the tenant's live-visits Blobs store (see _lib/records.js) so
// it feeds the same dashboard aggregation as backfilled history. A
// field_rep can only check into a store they've been assigned.

const jwt = require('./_lib/jwt');
const { saveLiveVisit } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (claims.role === 'field_rep' && !(claims.storeCodes || []).includes(body.store_id)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Store not assigned to this rep' }) };
  }

  const visit = {
    id: `visit_${Date.now()}`,
    tenantId: claims.tenantId,
    storeCode: body.store_id,
    repEmail: claims.email,
    checkin_at: new Date().toISOString(),
    checkout_at: null,
    tasks: {},
  };
  await saveLiveVisit(claims.tenantCode, visit);

  return {
    statusCode: 200,
    body: JSON.stringify({ id: visit.id, tenant_id: visit.tenantId, store_id: visit.storeCode, checkin_at: visit.checkin_at }),
  };
};
