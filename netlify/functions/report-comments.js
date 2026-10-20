// GET  /api/report-comments?tenant=CIV-088
//        → { tenant, comments: [ { id, store, name, text, at } ] }  newest first
// POST /api/report-comments   { tenant, store?, name, text }
//        → { ok: true, comment }
//
// The comment thread on a client's report dashboard: one general thread plus
// per-store notes (a comment with `store` set is a note on that store; empty
// `store` is the general thread). Everyone who can open the dashboard can
// read and post — the page is already behind the monthly access code, and a
// comment carries no data the reader can't already see.
//
// APPEND-ONLY, like report-history: one immutable blob per comment. Nothing
// here edits or deletes a comment; removing one is a deliberate separate
// operation, not something a post can do by accident.

const { blobsStore } = require('./_lib/records');

const PUBLIC_REPORT_TENANTS = ['PH-201', 'CIV-088', 'SQ-330'];

const MAX_NAME = 60;
const MAX_TEXT = 2000;
const MAX_STORE = 200;

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'GET') {
    const tenantCode = (event.queryStringParameters?.tenant || 'CIV-088').trim().toUpperCase();
    if (!PUBLIC_REPORT_TENANTS.includes(tenantCode)) {
      return { statusCode: 404, body: JSON.stringify({ error: 'No published report for that client' }) };
    }
    const store = blobsStore(`report-comments-${tenantCode}`);
    let comments = [];
    try {
      const { blobs } = await store.list();
      const rows = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      // Keys are timestamp-prefixed, so a plain descending sort is newest first.
      comments = rows.filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    } catch {
      // Degrade to an empty thread rather than breaking the dashboard.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ tenant: tenantCode, comments: [], error: 'comments unavailable' }),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ tenant: tenantCode, count: comments.length, comments }),
    };
  }

  if (method !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const tenantCode = (body.tenant || 'CIV-088').trim().toUpperCase();
  if (!PUBLIC_REPORT_TENANTS.includes(tenantCode)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown tenant' }) };
  }

  const name = clean(body.name, MAX_NAME);
  const text = clean(body.text, MAX_TEXT);
  const storeName = clean(body.store, MAX_STORE);
  if (!name) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Add your name so the team knows who commented.' }) };
  if (!text) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Write a comment first.' }) };

  const at = new Date().toISOString();
  const id = `${at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const comment = { id, store: storeName, name, text, at };

  const store = blobsStore(`report-comments-${tenantCode}`);
  await store.setJSON(id, comment);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, tenant: tenantCode, comment }),
  };
};
