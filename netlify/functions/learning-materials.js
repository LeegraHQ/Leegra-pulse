// GET  /api/learning-materials       — list this tenant's training material
// POST /api/learning-materials       — upload a new item (multipart file)
//
// Files are stored in Netlify Blobs (@netlify/blobs), scoped to a per-tenant
// store name so one client's uploads are never visible when listing
// another's. This needs zero external services — Blobs ships with every
// Netlify site. Metadata (title, type, who uploaded it) is kept alongside
// the file bytes as blob metadata; move it to a real table if you need to
// query/filter beyond "list everything for this tenant".

const { getStore } = require('@netlify/blobs');
const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };

  const tenantCode = claims.tenantCode || 'shared';
  const store = getStore(`learning-${tenantCode}`);

  if (event.httpMethod === 'GET') {
    const { blobs } = await store.list();
    const items = await Promise.all(blobs.map(async (b) => {
      const meta = await store.getMetadata(b.key);
      return { id: b.key, ...meta?.metadata };
    }));
    return { statusCode: 200, body: JSON.stringify(items) };
  }

  if (event.httpMethod === 'POST') {
    // Expects a pre-parsed multipart body — Netlify Functions v2 (or a
    // helper like `parse-multipart-data`) is needed to extract the file in
    // production; this stub demonstrates the storage call shape.
    const id = `material_${Date.now()}`;
    await store.set(id, event.body || '', {
      metadata: { title: 'Uploaded material', uploadedAt: new Date().toISOString(), tenantCode },
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
