// POST /api/admin-stores-import
// Body: { rows: [{ name, code, region, address?, lat?, lng? }, ...] }
// Bulk-loads a tenant's store base in one call — this is how you go from
// zero stores to a client's full branch list. Auth: super-admin token, or a
// client_admin token (whose own tenantId is used automatically — a
// client_admin can only ever import into their own tenant, never another's).
//
// Pair this with the CSV template at templates/stores-template.csv: give
// clients that file, they fill it in, you convert rows to JSON (any
// spreadsheet app can export CSV -> most no-code tools, or a 5-line script,
// convert CSV -> this JSON shape) and POST it here.

const jwt = require('./_lib/jwt');
const { blobsStore } = require('./_lib/records');
const { LEEGRA_WRITE_ROLES } = require('./_data');
const { tenantScopeOk } = require('./_lib/scope');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (![...LEEGRA_WRITE_ROLES, 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : (body.tenant_code || claims.scopedTenantCode);
  if (!tenantCode) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code required for super-admin imports' }) };
  if (claims.role !== 'client_admin' && !tenantScopeOk(claims, tenantCode)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted for that tenant' }) };
  }
  if (!Array.isArray(body.rows) || !body.rows.length) return { statusCode: 400, body: JSON.stringify({ error: 'rows[] required' }) };

  // Demo storage: Netlify Blobs, one JSON blob per tenant. Swap for an
  // UPSERT into a real `stores` table (see BACKEND.md) once a DB exists —
  // the important part to keep is that tenant_code always drives the key,
  // never something taken from the row data itself.
  // Merge by code (last write wins) rather than blind-append — a retried
  // call (e.g. after a transient 401 from the Blobs backend that actually
  // wrote before erroring) must not duplicate every store it already added.
  const store = blobsStore(`stores-${tenantCode}`);
  const existing = (await store.get('base', { type: 'json' })) || [];
  const byCode = new Map(existing.map(s => [s.code, s]));
  for (const row of body.rows) byCode.set(row.code, row);
  const merged = [...byCode.values()];
  await store.setJSON('base', merged);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, total_stores: merged.length }) };
};
