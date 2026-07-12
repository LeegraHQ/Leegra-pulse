// POST /api/admin-visits-import
// Body: { rows: [{ store_code, rep_email, checkin_at, checkout_at, tasks: {...} }, ...] }
// Backfills historical visit history (e.g. the last 3 months from a client's
// old system/spreadsheet) so the dashboard's compliance %, trends and
// leaderboard have real history from day one instead of starting at zero.
// Import in batches (a few hundred rows per call) rather than one giant
// payload — Netlify Functions have a request size/time limit.

const jwt = require('./_lib/jwt');
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!['leegra_super_admin', 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : body.tenant_code;
  if (!tenantCode || !Array.isArray(body.rows) || !body.rows.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code and rows[] required' }) };
  }

  // Demo storage: Netlify Blobs, appended in batches. Once a real DB exists,
  // this becomes a bulk INSERT into `visits` (+ `visit_tasks`) instead —
  // keep batching on the client side either way (a few hundred rows/call).
  const store = getStore(`visits-history-${tenantCode}`);
  const batchKey = `batch_${Date.now()}`;
  await store.setJSON(batchKey, body.rows);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, imported: body.rows.length, batch: batchKey }) };
};
