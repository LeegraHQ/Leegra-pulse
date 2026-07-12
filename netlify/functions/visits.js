// POST /api/visits  { store_id, visit_type? }  — starts a visit for the
// logged-in rep. Resolves the tenant's best-matching questionnaire (see
// _lib/records.js's pickQuestionnaire) for this store/visit type and
// snapshots its questions onto the visit, so later edits to the
// questionnaire don't change an in-progress visit's questions underneath
// the rep. A field_rep can only check into a store they've been assigned.

const jwt = require('./_lib/jwt');
const { saveLiveVisit, getQuestionnaires, pickQuestionnaire } = require('./_lib/records');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (claims.role === 'field_rep' && !(claims.storeCodes || []).includes(body.store_id)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Store not assigned to this rep' }) };
  }

  const questionnaires = await getQuestionnaires(claims.tenantCode);
  const matched = pickQuestionnaire(questionnaires, body.store_id, body.visit_type);

  const visit = {
    id: `visit_${Date.now()}`,
    tenantId: claims.tenantId,
    storeCode: body.store_id,
    repEmail: claims.email,
    checkin_at: new Date().toISOString(),
    checkout_at: null,
    questionnaireId: matched?.id || null,
    questionnaireName: matched?.name || null,
    questions: matched?.questions || [],
    answers: {},
  };
  await saveLiveVisit(claims.tenantCode, visit);

  return {
    statusCode: 200,
    body: JSON.stringify({
      id: visit.id,
      tenant_id: visit.tenantId,
      store_id: visit.storeCode,
      checkin_at: visit.checkin_at,
      questionnaire: { id: visit.questionnaireId, name: visit.questionnaireName, questions: visit.questions },
    }),
  };
};
