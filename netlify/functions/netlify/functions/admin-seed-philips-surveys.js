// POST /api/admin-seed-philips-surveys   { code: "<admin access code>" }
//
// One-shot load of the three Philips (PH-201) weekly-cadence surveys from
// _philips-survey-seed.json:
//
//   Stock Count & Pricing Feedback   visit_type: stock_pricing
//   Execution (Image Report)         visit_type: execution_image
//   Competitor Feedback              visit_type: competitor_feedback
//
// Each is scoped to the 510 PH-201 stores that are NOT Dis-Chem, and each
// carries a 'repeat' question so one visit can hold many SKU lines — the
// shape the client's reporting workbook is in.
//
// Idempotent: questionnaires are merged by id, so re-running updates the
// three in place and never touches any other questionnaire on the tenant
// (the Snag Report keeps working exactly as before). Auth is the monthly
// admin access code in the body, not a JWT, so this is runnable before
// anyone has an admin login on the tenant — same pattern as
// admin-seed-philips.js.

const accessCode = require('./_lib/accesscode');
const { getQuestionnaires, saveQuestionnaires } = require('./_lib/records');
const SEED = require('./_philips-survey-seed.json');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin code required' }) };
  }

  const tenantCode = SEED.tenantCode;
  const list = await getQuestionnaires(tenantCode);
  const byId = new Map(list.map(q => [q.id, q]));

  const loaded = [];
  for (const q of SEED.questionnaires) {
    const record = { ...q, updatedAt: new Date().toISOString() };
    byId.set(record.id, record);
    loaded.push({
      id: record.id,
      name: record.name,
      visit_type: record.visitType,
      stores: record.storeCodes.length,
      questions: record.questions.length,
      line_fields: (record.questions.find(x => x.type === 'repeat')?.fields || []).length,
    });
  }

  await saveQuestionnaires(tenantCode, [...byId.values()]);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      tenant_code: tenantCode,
      excluded: SEED.excluded,
      store_count: SEED.storeCount,
      loaded,
      questionnaires_total: byId.size,
    }),
  };
};
