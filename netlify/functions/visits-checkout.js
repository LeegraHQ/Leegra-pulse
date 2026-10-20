// POST /api/visits-checkout  { visit_id, answers? } — closes the rep's own
// in-progress visit, refusing to close if any question marked `required` in
// the visit's questionnaire snapshot hasn't been answered yet.
//
// `answers` (optional) is the app's full answer set, merged in before the
// check: separate per-answer saves can overwrite each other in storage, so
// the submit carries everything in one write. The store/rep header questions
// are then filled server-side from the visit itself, so they can never block
// a submit.

const jwt = require('./_lib/jwt');
const { getLiveVisit, saveLiveVisit, getStores, getUsers } = require('./_lib/records');

// Photo questions on/off. Photos are stored in Supabase (falls back to Netlify Blobs).
const PHOTOS_ENABLED = true;

function isAnswered(answer) {
  return answer !== undefined && answer !== null && answer !== '';
}

function repeatProblem(q, rows) {
  if (!Array.isArray(rows) || !rows.length) return `${q.label} — add at least one ${(q.rowLabel || 'row').toLowerCase()}`;
  const required = (q.fields || []).filter(f => f.required && (PHOTOS_ENABLED || f.type !== 'photo'));
  for (let i = 0; i < rows.length; i++) {
    const missing = required.filter(f => !isAnswered(rows[i]?.[f.id])).map(f => f.label);
    if (missing.length) return `${q.label} ${i + 1} — ${missing.join(', ')}`;
  }
  return null;
}

function nameFromEmail(email) {
  return String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const HEADER_IDS = ['blitz', 'rep_name', 'channel', 'store_code', 'store_name', 'region'];

async function fillHeaders(tenantCode, visit) {
  const qs = (visit.questions || []).filter(q => HEADER_IDS.includes(q.id) && !isAnswered(visit.answers[q.id]));
  if (!qs.length) return;
  const [stores, users] = await Promise.all([getStores(tenantCode).catch(() => []), getUsers(tenantCode).catch(() => [])]);
  const store = stores.find(s => s.code === visit.storeCode) || {};
  const user = users.find(u => (u.email || '').toLowerCase() === String(visit.repEmail || '').toLowerCase()) || {};
  const rep = user.name || nameFromEmail(visit.repEmail);
  const vals = {
    blitz: rep, rep_name: rep,
    channel: store.channel || 'Other',
    store_code: visit.storeCode || store.code || '',
    store_name: store.name || visit.storeCode || '',
    region: store.region || 'Unassigned',
  };
  for (const q of qs) if (isAnswered(vals[q.id])) visit.answers[q.id] = vals[q.id];
}

const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return json(401, { error: 'Not authenticated' });
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const visit = await getLiveVisit(claims.tenantCode, body.visit_id);
  if (!visit || visit.repEmail !== claims.email) return json(404, { error: 'Visit not found' });

  visit.answers = visit.answers || {};
  if (body.answers && typeof body.answers === 'object') {
    for (const [qid, val] of Object.entries(body.answers)) {
      if (!isAnswered(val)) continue;
      // Photos are saved by their own upload call; never let a client copy
      // without a photoId replace the stored one.
      if (val && typeof val === 'object' && !Array.isArray(val) && !val.photoId) continue;
      visit.answers[qid] = val;
    }
  }
  await fillHeaders(claims.tenantCode, visit);

  const missing = [];
  for (const q of (visit.questions || [])) {
    if (q.type === 'repeat') {
      if (!q.required) continue;
      const problem = repeatProblem(q, visit.answers[q.id]);
      if (problem) missing.push(problem);
    } else if (q.type === 'photo' && !PHOTOS_ENABLED) {
      continue;
    } else if (q.required && !isAnswered(visit.answers[q.id])) {
      missing.push(q.label);
    }
  }
  if (missing.length) {
    await saveLiveVisit(claims.tenantCode, visit);
    return json(400, { error: 'Answer all required questions before checking out', missing });
  }

  visit.checkout_at = new Date().toISOString();
  await saveLiveVisit(claims.tenantCode, visit);
  return json(200, { checkout_at: visit.checkout_at });
};
