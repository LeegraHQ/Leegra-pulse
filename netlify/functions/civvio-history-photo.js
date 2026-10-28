// POST /api/civvio-history-photo  { code: "<admin code>", storeCode, date: "YYYY-MM-DD", caption?, dataUrl }
//   → { ok, photo: { id, storeCode, date, caption } }
// One photo for a past DMQ store visit. The image goes to Supabase Storage via
// records.savePhoto (Blobs fallback); the link to store + date is kept in Blobs
// and civvio-execution attaches it to the matching past visit.

const accessCode = require('./_lib/accesscode');
const { blobsStore, savePhoto } = require('./_lib/records');

const TENANT = 'CIV-088';
const MAX_BYTES = 5 * 1024 * 1024;
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!accessCode.isAdminCode(clip(body.code, 64))) return json(403, { error: 'Admin code required' });

  const storeCode = clip(body.storeCode, 40).toUpperCase();
  const date = clip(body.date, 10);
  if (!storeCode) return json(400, { error: 'Pick a store' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: 'Pick a visit date' });
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(body.dataUrl || ''));
  if (!m) return json(400, { error: 'Not an image' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return json(400, { error: 'Image too large' });

  const id = 'hist-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const storage = await savePhoto(TENANT, id, buf, m[1]);
  const photo = { id, storeCode, date, caption: clip(body.caption, 300), storage, uploadedAt: new Date().toISOString() };
  await blobsStore(`civvio-history-photos-${TENANT}`).setJSON(id, photo);
  return json(200, { ok: true, photo });
};
