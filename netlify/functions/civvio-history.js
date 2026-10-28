// POST /api/civvio-history  { code: "<admin code>", rows: [...], fileName? }
//   rows: [{ date: "YYYY-MM-DD", storeCode, storeName?, channel?, region?, rep?,
//            facings?, returns?, damaged?, additional?, comment? }]
// Appends one batch of past DMQ store visits (from DMQ-Past-Visits-Template.xlsx).
// Append-only: each upload is its own batch; civvio-execution merges them into
// the dashboard next to live app visits.

const accessCode = require('./_lib/accesscode');
const { blobsStore } = require('./_lib/records');

const TENANT = 'CIV-088';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const yn = v => { const s = clip(v, 5).toLowerCase(); return s === 'yes' || s === 'y' ? 'Yes' : s === 'no' || s === 'n' ? 'No' : ''; };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!accessCode.isAdminCode(clip(body.code, 64))) return json(403, { error: 'Admin code required' });

  const rows = [];
  let skipped = 0;
  for (const r of Array.isArray(body.rows) ? body.rows : []) {
    const date = clip(r && r.date, 10);
    const storeCode = clip(r && r.storeCode, 40).toUpperCase();
    const month = clip(r && r.month, 7);
    // No visit date but a month: a placeholder ("Busy uploading") for that store + month.
    if (!date && /^\d{4}-\d{2}$/.test(month) && storeCode) {
      rows.push({ pending: true, month, storeCode, storeName: clip(r.storeName, 120), comment: clip(r.comment, 1000) || 'Busy uploading' });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !storeCode) { skipped++; continue; }
    const f = r.facings === '' || r.facings == null || isNaN(Number(r.facings)) ? null : Number(r.facings);
    rows.push({
      date, storeCode,
      storeName: clip(r.storeName, 120), channel: clip(r.channel, 40), region: clip(r.region, 40), rep: clip(r.rep, 60),
      facings: f, returns: yn(r.returns), damaged: yn(r.damaged), additional: yn(r.additional),
      comment: clip(r.comment, 1000),
    });
  }
  if (!rows.length) return json(400, { error: 'No rows with a visit date and store code', skipped });
  const pending = rows.filter(r => r.pending).length;

  const store = blobsStore(`civvio-history-${TENANT}`);
  const key = new Date().toISOString().replace(/[:.]/g, '-');
  await store.setJSON(key, { rows, fileName: clip(body.fileName, 120) || null, uploadedAt: new Date().toISOString() });
  return json(200, { ok: true, rows_added: rows.length - pending, pending, skipped, batch: key });
};
