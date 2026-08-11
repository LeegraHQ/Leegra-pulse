// GET /api/health              — is photo storage working, and is the code set?
// GET /api/health?code=1105    — additionally: would that code be accepted?
//
// Open this in a browser. It answers in plain terms, with no sign-in needed,
// so it can be used to diagnose sign-in itself.
const db = require('./_lib/supabase');
const accessCode = require('./_lib/accesscode');

const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'visit-photos';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) });

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};

  const checks = {
    supabase_url: !!process.env.SUPABASE_URL,
    service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwt_secret: !!process.env.JWT_SECRET,
    access_code_current_set: !!process.env.ACCESS_CODE_CURRENT,
    access_code_current_length: (process.env.ACCESS_CODE_CURRENT || '').length,
    bucket: BUCKET,
    tables: {},
    storage: null,
  };

  // Does the supplied code work? Never echoes the configured code back.
  if (q.code) {
    checks.supplied_code_accepted = accessCode.verify('CIV-088', q.code);
  }

  if (!db.configured()) {
    return json(200, { ok: false, photos_persist: false, summary: 'Supabase env vars are missing — photos are saving in each browser only.', checks });
  }

  for (const table of ['visit_photos', 'client_month_metrics', 'store_call_updates']) {
    try { await db.select(table, '?select=*&limit=1'); checks.tables[table] = 'ok'; }
    catch (e) { checks.tables[table] = 'missing or unreadable — run the SQL in SUPABASE_SETUP.md'; }
  }

  try {
    await db.uploadToBucket(BUCKET, '_health/probe.txt', Buffer.from('leegra-pulse health probe'), 'text/plain');
    checks.storage = 'ok — wrote a test file to the bucket';
  } catch (e) {
    checks.storage = 'failed: ' + String(e.message || e).slice(0, 200);
  }

  const ok = checks.tables.visit_photos === 'ok' && String(checks.storage).startsWith('ok');
  return json(200, {
    ok,
    photos_persist: ok,
    summary: ok
      ? 'Photo storage is live. Uploads stay in the dashboard for everyone.'
      : 'Photo storage is not ready yet — see the checks below.',
    checks,
  });
};
