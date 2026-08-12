// GET  /api/schedule?month=2026-08  → { month, assignments, notes, owners, updatedAt }
// PUT  /api/schedule                → save the whole plan for a month
//
// The store execution roll-out plan: which store is being done on which day,
// by whom, with a comment. Leegra staff only — this is an internal plan, not
// tenant-scoped, so no client login can read or write it.

const jwt = require('./_lib/jwt');
const { blobsStore } = require('./_lib/records');
const { LEEGRA_ROLES, LEEGRA_WRITE_ROLES } = require('./_data');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const store = () => blobsStore('execution-schedule');
const monthKey = m => (/^\d{4}-\d{2}$/.test(m || '') ? m : new Date().toISOString().slice(0, 7));

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return json(401, { error: 'Not authenticated' });
  if (!LEEGRA_ROLES.includes(claims.role)) return json(403, { error: 'Leegra staff only' });

  if (event.httpMethod === 'GET') {
    const month = monthKey((event.queryStringParameters || {}).month);
    const saved = (await store().get(month, { type: 'json' })) || {};
    return json(200, {
      month,
      assignments: saved.assignments || {},
      notes: saved.notes || {},
      owners: saved.owners || {},
      adhoc: Array.isArray(saved.adhoc) ? saved.adhoc : [],
      updatedAt: saved.updatedAt || null,
      updatedBy: saved.updatedBy || null,
    });
  }

  if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
    if (!LEEGRA_WRITE_ROLES.includes(claims.role)) return json(403, { error: 'Read-only account' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
    const month = monthKey(body.month);
    const record = {
      assignments: body.assignments && typeof body.assignments === 'object' ? body.assignments : {},
      notes: body.notes && typeof body.notes === 'object' ? body.notes : {},
      owners: body.owners && typeof body.owners === 'object' ? body.owners : {},
      adhoc: Array.isArray(body.adhoc) ? body.adhoc.slice(0, 500) : [],
      updatedAt: new Date().toISOString(),
      updatedBy: claims.email || 'unknown',
    };
    await store().setJSON(month, record);
    return json(200, { ok: true, month, updatedAt: record.updatedAt, updatedBy: record.updatedBy });
  }

  return json(405, { error: 'Method not allowed' });
};
