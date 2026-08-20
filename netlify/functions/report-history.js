// GET  /api/report-history?tenant=PH-201
//        → { sections: { attendance: [...rows], feedback: [...rows], ... } }
// POST /api/report-history   { code, tenant, section, rows, fileName? }
//        → appends one upload batch
//
// Persistent home for the historic report data that used to live only in the
// static phillips_data.json sidecar. The report pages read this on load and
// merge it under the live app feed, so an uploaded history survives reloads
// and redeploys.
//
// APPEND-ONLY BY DESIGN. Each upload is stored as its own immutable batch
// blob keyed by timestamp; nothing here ever overwrites or deletes a previous
// batch. Uploading a second month of history adds to the first rather than
// replacing it. (Removing a bad batch is a deliberate, separate operation —
// not something an upload can do by accident.)

const accessCode = require('./_lib/accesscode');
const { blobsStore } = require('./_lib/records');

const PUBLIC_REPORT_TENANTS = ['PH-201', 'CIV-088', 'SQ-330'];

// Mirrors the sidecar's top-level keys — the row shapes the dashboards read.
const SECTIONS = [
  'feedback', 'attendance', 'salesValue', 'salesVolume', 'growth',
  'stock', 'stockPricing', 'competitorFeedback', 'executionReport',
];

exports.handler = async (event) => {
  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};

  if (method === 'GET') {
    const tenantCode = (qs.tenant || 'PH-201').trim().toUpperCase();
    if (!PUBLIC_REPORT_TENANTS.includes(tenantCode)) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No published report for that client' }) };
    }
    const store = blobsStore(`report-history-${tenantCode}`);
    const sections = {};
    let batchCount = 0;
    try {
      const { blobs } = await store.list();
      // Oldest batch first, so the merged history reads in upload order.
      const keys = blobs.map(b => b.key).sort();
      const batches = await Promise.all(keys.map(k => store.get(k, { type: 'json' })));
      for (const batch of batches) {
        if (!batch || !batch.section || !Array.isArray(batch.rows)) continue;
        batchCount += 1;
        sections[batch.section] = (sections[batch.section] || []).concat(batch.rows);
      }
    } catch {
      // Degrade to "no stored history" — the page still has its live feed.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ tenant: tenantCode, sections: {}, batchCount: 0, error: 'history unavailable' }),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ tenant: tenantCode, batchCount, sections }),
    };
  }

  if (method !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin code required' }) };
  }

  const tenantCode = (body.tenant || 'PH-201').trim().toUpperCase();
  if (!PUBLIC_REPORT_TENANTS.includes(tenantCode)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown tenant' }) };
  }
  if (!SECTIONS.includes(body.section)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'section must be one of: ' + SECTIONS.join(', ') }) };
  }
  const rows = Array.isArray(body.rows) ? body.rows.filter(r => Array.isArray(r) && r.some(c => String(c || '').trim())) : [];
  if (!rows.length) return { statusCode: 400, body: JSON.stringify({ error: 'rows[] required' }) };

  const store = blobsStore(`report-history-${tenantCode}`);
  const key = `${new Date().toISOString().replace(/[:.]/g, '-')}-${body.section}`;
  await store.setJSON(key, {
    section: body.section,
    rows,
    fileName: body.fileName || null,
    uploadedAt: new Date().toISOString(),
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, tenant: tenantCode, section: body.section, rows_added: rows.length, batch: key }),
  };
};
