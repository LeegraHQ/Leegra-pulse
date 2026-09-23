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

const { getLiveVisits, getStores, getUsers } = require('./_lib/records');

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
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  const tenantCode = (event.queryStringParameters?.tenant || 'PH-201').trim().toUpperCase();
  const meta = PUBLIC_REPORT_TENANTS[tenantCode];
  if (!meta) return { statusCode: 404, body: JSON.stringify({ error: 'No published report for that client' }) };

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
    // The dashboard falls back to its static sidecar, so a storage blip must
    // degrade to "no live rows" rather than breaking the page.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ tenant: tenantCode, attendance: [], feedback: [], error: 'live feed unavailable' }),
    };
  }

  const storeByCode = {};
  for (const s of stores) storeByCode[s.code] = s;
  const nameByEmail = {};
  for (const u of users) if (u.email && u.name) nameByEmail[u.email.toLowerCase()] = u.name;

  const repName = (email) => nameByEmail[String(email || '').toLowerCase()] || nameFromEmail(email);

  const attendance = [];
  const feedback = [];

  for (const v of visits) {
    if (!v.checkin_at) continue;
    const store = storeByCode[v.storeCode] || {};
    const storeName = store.name || v.storeCode || '';
    const channel = channelOf(storeName);
    const region = store.region || 'Unassigned';
    const rep = repName(v.repEmail);
    const date = datePart(v.checkin_at);

    attendance.push([
      rep,
      date,
      timePart(v.checkin_at),
      v.checkout_at ? timePart(v.checkout_at) : '',
      v.checkout_at ? durationHHMM(v.checkin_at, v.checkout_at) : '',
      channel,
      channel,
      storeName,
    ]);

    // Questionnaire answers become Survey Answer rows. The dashboard treats
    // "yes" as available and anything else as not, so booleans are mapped to
    // Yes/No and free text passes through as-is.
    const questions = v.questions || [];
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
      attendance,
      feedback,
    }),
  };
};
