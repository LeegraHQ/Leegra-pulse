// GET  /api/admin-questionnaire-import                 — list this tenant's questionnaires
// POST /api/admin-questionnaire-import                  — create or update one
// Body: {
//   tenant_code?,                 // required for super-admin, ignored for client_admin (uses their own)
//   id?,                          // omit to create new; pass an existing id to replace it
//   name,                         // e.g. "New Store Audit", "Routine Check-in"
//   store_codes?: [...],          // if set, this questionnaire only applies to these stores
//   visit_type?: string,          // if set, only applies when the rep checks in with this visit type
//   questions: [
//     { id?, label, type: 'boolean'|'number'|'text'|'choice', options?: [...], required?: bool }
//   ]
// }
// Leaving both store_codes and visit_type unset makes this the tenant-wide
// default, used when nothing more specific matches (see _lib/records.js's
// pickQuestionnaire). Auth: super-admin, or a client_admin (own tenant only).

const jwt = require('./_lib/jwt');
const { getQuestionnaires, saveQuestionnaires } = require('./_lib/records');
const { LEEGRA_WRITE_ROLES } = require('./_data');

function normalizeQuestions(questions) {
  return (questions || []).map((q, i) => ({
    id: q.id || `q_${i}_${String(q.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`,
    label: q.label,
    type: ['boolean', 'number', 'text', 'choice'].includes(q.type) ? q.type : 'boolean',
    options: q.type === 'choice' ? (q.options || []) : undefined,
    required: !!q.required,
  }));
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (![...LEEGRA_WRITE_ROLES, 'client_admin'].includes(claims.role)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not permitted' }) };
  }

  if (event.httpMethod === 'GET') {
    const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : event.queryStringParameters?.tenant_code;
    if (!tenantCode) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code required for super-admin' }) };
    const list = await getQuestionnaires(tenantCode);
    return { statusCode: 200, body: JSON.stringify({ tenant_code: tenantCode, questionnaires: list }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const tenantCode = claims.role === 'client_admin' ? claims.tenantCode : body.tenant_code;
  if (!tenantCode) return { statusCode: 400, body: JSON.stringify({ error: 'tenant_code required for super-admin imports' }) };
  if (!body.name || !Array.isArray(body.questions) || !body.questions.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'name and questions[] required' }) };
  }

  const list = await getQuestionnaires(tenantCode);
  const record = {
    id: body.id || `qn_${Date.now()}`,
    name: body.name,
    storeCodes: Array.isArray(body.store_codes) ? body.store_codes : [],
    visitType: body.visit_type || null,
    questions: normalizeQuestions(body.questions),
    updatedAt: new Date().toISOString(),
  };
  const idx = list.findIndex(q => q.id === record.id);
  if (idx >= 0) list[idx] = record; else list.push(record);
  await saveQuestionnaires(tenantCode, list);

  return { statusCode: 200, body: JSON.stringify({ ok: true, tenant_code: tenantCode, questionnaire: record }) };
};
