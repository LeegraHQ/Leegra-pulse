// POST /api/visits-checkout  { visit_id } — closes the rep's own in-progress
// visit, refusing to close if any question marked `required` in the visit's
// questionnaire snapshot hasn't been answered yet.

const jwt = require('./_lib/jwt');
const { getLiveVisit, saveLiveVisit } = require('./_lib/records');

function isAnswered(answer) {
  return answer !== undefined && answer !== null && answer !== '';
}

// A required 'repeat' needs at least one row, and every row must carry its
// own required fields — otherwise a rep could add three blank SKU lines and
// check out with nothing captured.
function repeatProblem(q, rows) {
  if (!Array.isArray(rows) || !rows.length) return `${q.label} — add at least one ${(q.rowLabel || 'row').toLowerCase()}`;
  const required = (q.fields || []).filter(f => f.required);
  for (let i = 0; i < rows.length; i++) {
    const missing = required.filter(f => !isAnswered(rows[i]?.[f.id])).map(f => f.label);
    if (missing.length) return `${q.label} ${i + 1} — ${missing.join(', ')}`;
  }
  return null;
}

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const visit = await getLiveVisit(claims.tenantCode, body.visit_id);
  if (!visit || visit.repEmail !== claims.email) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Visit not found' }) };
  }

  const missing = [];
  for (const q of (visit.questions || [])) {
    if (q.type === 'repeat') {
      if (!q.required) continue;
      const problem = repeatProblem(q, visit.answers?.[q.id]);
      if (problem) missing.push(problem);
    } else if (q.required && !isAnswered(visit.answers?.[q.id])) {
      missing.push(q.label);
    }
  }
  if (missing.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Answer all required questions before checking out', missing }) };
  }

  visit.checkout_at = new Date().toISOString();
  await saveLiveVisit(claims.tenantCode, visit);

  return { statusCode: 200, body: JSON.stringify({ checkout_at: visit.checkout_at }) };
};
