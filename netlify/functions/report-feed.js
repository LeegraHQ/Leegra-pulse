// GET /api/report-feed?tenant=PH-201
//
// Read-only bridge from the field app to a client's public report dashboard.
// The report pages under public/reports/<slug>/ were built to read a static
// sidecar (phillips_data.json) exported from Excel. This returns the SAME
// row shapes, but built from what reps actually did in the app — live
// check-ins persisted by visits.js / visits-checkout.js — so the dashboard
// can show today's field activity without a re-export.
//
// Row shapes (positional, matching the sidecar exactly):
//   attendance: [Name, Date, Check In, Check Out, Time Spent, Channel, Banner, Store]
//   feedback:   [Survey, Supplier, Region, Staff, Category, Store, Question, Response, Date]
//
// No auth: the sidecar it supplements is already a public static file on the
// same path, so this exposes nothing new. It is strictly read-only, and only
// tenants with a published report page are served (PUBLIC_REPORT_TENANTS).

const { getLiveVisits, getStores, getUsers, getPhoto } = require('./_lib/records');

const PUBLIC_REPORT_TENANTS = {
  'PH-201': { supplier: 'Philips', survey: 'Pulse App Check-in' },
  'CIV-088': { supplier: 'Civvio', survey: 'Pulse App Check-in' },
  'SQ-330': { supplier: 'Supa Quick', survey: 'Pulse App Check-in' },
};

// Store names in the Philips master list are "CHANNEL BRANCH - CODE", so the
// leading words carry the channel. Longest prefixes first so "DIS-CHEM BABY
// CITY ..." doesn't resolve to BABY CITY.
const CHANNEL_PREFIXES = [
  'DIS-CHEM', 'DISCHEM', 'CHECKERS HYPER', 'CHECKERS', 'CLICKS', 'MAKRO',
  'BABY CITY', 'BABIES R US', 'MEDIRITE PLUS', 'MEDIRITE', 'ISER', 'TAFELBERG',
  'LITTLE ME', 'GAME', 'PICK N PAY', 'SHOPRITE', 'TAKEALOT',
];

function channelOf(storeName) {
  const upper = String(storeName || '').toUpperCase();
  return CHANNEL_PREFIXES.find(p => upper.startsWith(p)) || 'Other';
}

// "lerato.n@philips-retail.co.za" -> "Lerato N" when we have no better name.
function nameFromEmail(email) {
  return String(email || '').split('@')[0].split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const pad = (n) => String(n).padStart(2, '0');
// Reps work in South Africa (UTC+2, no DST). Stored timestamps are UTC, so
// shift before formatting — otherwise an 08:30 check-in shows as 06:30 and
// the dashboard's late-check-in flag never fires.
const SAST_MS = 2 * 60 * 60 * 1000;
const local = (iso) => new Date(new Date(iso).getTime() + SAST_MS);
const datePart = (iso) => local(iso).toISOString().slice(0, 10);
const timePart = (iso) => { const d = local(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// Time Spent is read by the dashboard with the same HH:MM parser as the
// clock columns, so it must be "H:MM" — not "45 min".
function durationHHMM(startIso, endIso) {
  const mins = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60000));
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
}

exports.handler = async (event) => {
  try {
    return await handle(event);
  } catch (err) {
    console.error('report-feed failed', err && err.stack);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ attendance: [], feedback: [], error: 'live feed error: ' + (err && err.message) }),
    };
  }
};

const validIso = (iso) => !!iso && !isNaN(new Date(iso).getTime());

async function handle(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  const tenantCode = (event.queryStringParameters?.tenant || 'PH-201').trim().toUpperCase();
  const meta = PUBLIC_REPORT_TENANTS[tenantCode];
  if (!meta) return { statusCode: 404, body: JSON.stringify({ error: 'No published report for that client' }) };

  // ?photo=<id> serves one rep photo for the public dashboard's galleries.
  const photoId = event.queryStringParameters?.photo;
  if (photoId) {
    const photo = await getPhoto(tenantCode, photoId).catch(() => null);
    if (!photo) return { statusCode: 404, body: 'Photo not found' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': photo.mime || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
      isBase64Encoded: true,
      body: Buffer.from(photo.bytes).toString('base64'),
    };
  }

  let visits = [];
  let stores = [];
  let users = [];
  try {
    [visits, stores, users] = await Promise.all([
      getLiveVisits(tenantCode),
      getStores(tenantCode),
      getUsers(tenantCode),
    ]);
  } catch (err) {
    console.error('report-feed read failed', err && err.message);
    // The dashboard falls back to its static sidecar, so a storage blip must
    // degrade to "no live rows" rather than breaking the page.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ tenant: tenantCode, attendance: [], feedback: [], error: 'live feed unavailable: ' + (err && err.message) }),
    };
  }

  const storeByCode = {};
  for (const s of stores) storeByCode[s.code] = s;
  const nameByEmail = {};
  for (const u of users) if (u.email && u.name) nameByEmail[u.email.toLowerCase()] = u.name;

  const repName = (email) => nameByEmail[String(email || '').toLowerCase()] || nameFromEmail(email);

  const attendance = [];
  const feedback = [];
  // Section tables, in the dashboard's positional row shapes (see the
  // headers in public/reports/philips/index.html).
  const stockPricing = [];
  const competitorFeedback = [];
  const executionReport = [];
  const executionPhotos = [];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : (v == null ? '' : String(v)));
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const photoUrl = (cell) => (cell && typeof cell === 'object' && cell.photoId
    ? `/api/report-feed?tenant=${encodeURIComponent(tenantCode)}&photo=${encodeURIComponent(cell.photoId)}` : '');

  let skipped = 0;
  for (const v of visits) {
    // One malformed visit (bad date, odd answer shape) must not take the whole feed down.
    if (!v || !validIso(v.checkin_at)) { skipped++; continue; }
    try {
    const store = storeByCode[v.storeCode] || {};
    const storeName = store.name || v.storeCode || '';
    const ans = v.answers || {};
    const channel = ans.channel || store.channel || channelOf(storeName);
    const region = ans.region || store.region || 'Unassigned';
    const rep = repName(v.repEmail);
    const date = datePart(v.checkin_at);
    const month = MONTHS[+date.slice(5, 7) - 1] + ' ' + date.slice(0, 4);
    const storeCode = v.storeCode || '';

    for (const row of Array.isArray(ans.sku_lines) ? ans.sku_lines : []) {
      if (!row || !row.sku_code) continue;
      const listed = yn(row.listing);
      stockPricing.push([rep, channel, storeCode, storeName, region, row.category || '', row.sku_code,
        num(row.philips_rrp), num(row.store_system_rrp), num(row.promo_price), yn(row.on_promo), row.sku_status || '',
        listed, photoUrl(row.proof_of_delisting) ? 'Photo' : '', num(row.store_system_mdq), num(row.total_soh),
        num(row.qty_on_shelf), num(row.qty_box_damages), num(row.qty_customer_returns), yn(row.additional_stock_required),
        date, month, listed === 'No' ? 'No' : 'Yes']);
    }
    for (const row of Array.isArray(ans.comp_lines) ? ans.comp_lines : []) {
      if (!row || !(row.competitor || row.competitor_sku)) continue;
      competitorFeedback.push([rep, channel, storeCode, storeName, region, row.category || '', row.competitor || '',
        row.competitor_sku || '', row.sku_status || '', num(row.competitor_price), yn(row.on_promo), num(row.total_soh),
        photoUrl(row.product_image), row.philips_sku || '', num(row.philips_on_shelf_price), date]);
    }
    for (const row of Array.isArray(ans.exec_lines) ? ans.exec_lines : []) {
      if (!row) continue;
      const before = photoUrl(row.before_image), after = photoUrl(row.after_image);
      if (!before && !after && !row.display_area) continue;
      executionReport.push([rep, channel, storeCode, storeName, region, row.category || '', before ? 'Photo' : '',
        row.display_area || '', row.sku_code || '', after ? 'Photo' : '', date, month, before && after ? 'Yes' : 'No']);
      for (const [stage, cell, url] of [['Before', row.before_image, before], ['After', row.after_image, after]]) {
        if (!url) continue;
        const taken = validIso(cell.takenAt) ? cell.takenAt : v.checkin_at;
        executionPhotos.push({ file: url, date: datePart(taken), time: timePart(taken), storeCode, storeName, channel, region, rep,
          displayArea: row.display_area || '', category: row.category || '', confirm: '', type: 'Execution', stage, source: 'app' });
      }
    }

    attendance.push([
      rep,
      date,
      timePart(v.checkin_at),
      validIso(v.checkout_at) ? timePart(v.checkout_at) : '',
      validIso(v.checkout_at) ? durationHHMM(v.checkin_at, v.checkout_at) : '',
      channel,
      channel,
      storeName,
    ]);

    // Questionnaire answers become Survey Answer rows. The dashboard treats
    // "yes" as available and anything else as not, so booleans are mapped to
    // Yes/No and free text passes through as-is.
    const questions = Array.isArray(v.questions) ? v.questions : [];
    const answers = v.answers || {};
    for (const q of questions) {
      const raw = answers[q.id];
      if (raw === undefined || raw === null || raw === '') continue;

      const pushRow = (question, response) => feedback.push([
        v.questionnaireName || meta.survey,
        meta.supplier,
        region,
        rep,
        q.category || q.section || 'General',
        storeName,
        question,
        response,
        date,
      ]);

      // A 'repeat' question (the SKU lines) answers with an ARRAY of row
      // objects keyed by field id. Stringifying that gave "[object Object]"
      // on the dashboard, so each row is expanded into one feedback row per
      // filled field, labelled "<Row N> · <field>".
      if (Array.isArray(raw)) {
        const rowLabel = q.rowLabel || 'Row';
        const fieldLabel = {};
        for (const f of q.fields || []) fieldLabel[f.id] = f.label || f.id;
        raw.forEach((row, idx) => {
          for (const [fieldId, cell] of Object.entries(row || {})) {
            if (cell === undefined || cell === null || cell === '') continue;
            const value = cell === true ? 'Yes'
              : cell === false ? 'No'
              : (cell && typeof cell === 'object') ? (cell.photoId ? 'Photo captured' : '')
              : String(cell);
            if (!value) continue;
            pushRow(`${rowLabel} ${idx + 1} · ${fieldLabel[fieldId] || fieldId}`, value);
          }
        });
        continue;
      }

      // A photo answer is { photoId, previewUrl } — record that it exists.
      if (raw && typeof raw === 'object') {
        if (raw.photoId) pushRow(q.label || q.id, 'Photo captured');
        continue;
      }

      pushRow(q.label || q.id, raw === true ? 'Yes' : raw === false ? 'No' : String(raw));
    }
    } catch (err) {
      skipped++;
      console.error('report-feed skipped visit', v.id, err && err.message);
    }
  }

  // Newest first — the dashboard slices the first 200 rows for display.
  attendance.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  feedback.sort((a, b) => (a[8] < b[8] ? 1 : a[8] > b[8] ? -1 : 0));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      tenant: tenantCode,
      generatedAt: new Date().toISOString(),
      visitCount: attendance.length,
      skippedVisits: skipped,
      attendance,
      feedback,
      stockPricing,
      competitorFeedback,
      executionReport,
      executionPhotos,
    }),
  };
}
