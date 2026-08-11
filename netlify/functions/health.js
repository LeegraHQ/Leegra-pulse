// GET /api/health — is photo storage actually working?
// Open this in a browser after setup. It reports, in plain terms, whether the
// env vars are set, the tables exist and the storage bucket is reachable.
const db = require('./_lib/supabase');

const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'visit-photos';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) });

exports.handler = async () => {
  const checks = {
    supabase_url: !!process.env.SUPABASE_URL,
    service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    jwt_secret: !!process.env.JWT_SECRET,
    access_code_secret: !!process.env.ACCESS_CODE_SECRET,
    email_key: !!process.env.RESEND_API_KEY,
    bucket: BUCKET,
    tables: {},
    storage: null,
  };

  if (!db.configured()) {
    return json(200, { ok: false, photos_persist: false, summary: 'Supabase env vars are missing — photos are saving in each browser only.', checks });
  }

  for (const table of ['visit_photos', 'client_month_metrics', 'store_call_updates']) {
    try { await db.select(table, '?select=*&limit=1'); checks.tables[table] = 'ok'; }
    catch (e) { checks.tables[table] = 'missing or unreadable — run the SQL in SUPABASE_SETUP.md'; }
  }

  try {
    const probe = Buffer.from('leegra-pulse health probe');
    await db.uploadToBucket(BUCKET, '_health/probe.txt', probe, 'text/plain');
    checks.storage = 'ok — wrote a test file to the bucket';
  } catch (e) {
    checks.storage = 'failed: ' + String(e.message || e).slice(0, 200);
  }

  const ok = checks.tables.visit_photos === 'ok' && checks.storage.startsWith('ok');
  return json(200, {
    ok,
    photos_persist: ok,
    summary: ok
      ? 'Photo storage is live. Uploads stay in the dashboard for everyone.'
      : 'Photo storage is not ready yet — see the checks below.',
    checks,
  });
};
