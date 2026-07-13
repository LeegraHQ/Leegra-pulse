// POST /api/admin-visit-clear
// Body: { tenant_code, all?: true, before?: ISO date, visit_ids?: [...] }
// Deletes live check-in/checkout records (and any photos attached to them)
// for a tenant — exactly one of `all`, `before`, or `visit_ids` must be
// given, so a bare/empty body can never wipe everything by accident.
// Only touches live app check-ins, never backfilled history from
// admin-visits-import (that's a separate data source, cleared separately
// if ever needed).
// Auth: super_user or admin only — report_export_only is read-only.

const jwt = require('./_lib/jwt');
const { LEEGRA_WRITE_ROLES } = require('./_data');
const { getLiveVisits, deleteLiveVisit, deletePhoto } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!LEEGRA_WRITE_ROLES.includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { tenant_code, all, before, visit_ids } = body;
  if (!tenant_code) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code required' }) };

  const modesGiven = [all === true, !!before, Array.isArray(visit_ids)].filter(Boolean).length;
  if (modesGiven !== 1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Provide exactly one of: all, before, visit_ids' }) };
  }

  const live = await getLiveVisits(tenant_code);
  let toDelete;
  if (all) {
    toDelete = live;
  } else if (before) {
    const cutoff = new Date(before);
    toDelete = live.filter(v => v.checkin_at && new Date(v.checkin_at) < cutoff);
  } else {
    const idSet = new Set(visit_ids);
    toDelete = live.filter(v => idSet.has(v.id));
  }

  for (const v of toDelete) {
    for (const answer of Object.values(v.answers || {})) {
      if (answer && typeof answer === 'object' && answer.photoId) {
        await deletePhoto(tenant_code, answer.photoId).catch(() => {});
      }
    }
    await deleteLiveVisit(tenant_code, v.id);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code, deleted: toDelete.length }) };
};
