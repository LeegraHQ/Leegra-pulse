// GET  /api/report-photos?tenant=PH-201&section=competitor  → { photos: [...meta] }
// GET  /api/report-photos?tenant=PH-201&id=<id>              → the image itself
// POST /api/report-photos  { code, tenant, section, dataUrl, fileName, store, competitor, note }
//
// Report-page photo uploads (e.g. Competitor Activity). Admin code required to
// add. Append-only: one image blob + one metadata blob per photo.

const accessCode = require('./_lib/accesscode');
const { blobsStore } = require('./_lib/records');

const PUBLIC_REPORT_TENANTS = ['PH-201', 'CIV-088', 'SQ-330'];
const SECTIONS = ['competitor'];
const MAX_BYTES = 4.5 * 1024 * 1024;
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const clip = (v, n) => String(v || '').trim().slice(0, n);

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const tenant = String(qs.tenant || 'PH-201').trim().toUpperCase();
    if (!PUBLIC_REPORT_TENANTS.includes(tenant)) return json(404, { error: 'No published report for that client' });
    const store = blobsStore(`report-photos-${tenant}`);

    if (qs.id) {
      const id = String(qs.id).replace(/[^\w-]/g, '');
      const hit = await store.getWithMetadata('img/' + id, { type: 'arrayBuffer' });
      if (!hit || !hit.data) return { statusCode: 404, body: 'Not found' };
      return {
        statusCode: 200,
        headers: { 'Content-Type': (hit.metadata && hit.metadata.mime) || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
        body: Buffer.from(hit.data).toString('base64'),
        isBase64Encoded: true,
      };
    }

    const section = String(qs.section || 'competitor');
    try {
      const { blobs } = await store.list({ prefix: 'meta/' });
      const metas = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      const photos = metas.filter(m => m && m.section === section).sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
      return json(200, { tenant, section, photos });
    } catch {
      return json(200, { tenant, section, photos: [], error: 'photos unavailable' });
    }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!accessCode.isAdminCode((body.code || '').trim())) return json(403, { error: 'Admin code required' });
  const tenant = String(body.tenant || 'PH-201').trim().toUpperCase();
  if (!PUBLIC_REPORT_TENANTS.includes(tenant)) return json(400, { error: 'Unknown tenant' });
  if (!SECTIONS.includes(body.section)) return json(400, { error: 'section must be one of: ' + SECTIONS.join(', ') });

  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(body.dataUrl || ''));
  if (!m) return json(400, { error: 'dataUrl must be a base64 image' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return json(400, { error: 'Image too large' });

  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 8);
  const store = blobsStore(`report-photos-${tenant}`);
  await store.set('img/' + id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { metadata: { mime: m[1] } });
  const meta = {
    id, section: body.section,
    fileName: clip(body.fileName, 200), store: clip(body.store, 120),
    competitor: clip(body.competitor, 120), note: clip(body.note, 500),
    uploadedAt: new Date().toISOString(),
  };
  await store.setJSON('meta/' + id, meta);
  return json(200, { ok: true, photo: meta });
};
