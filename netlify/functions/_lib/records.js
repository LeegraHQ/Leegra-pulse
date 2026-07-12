// Shared reads/writes against the Netlify Blobs stores that back stores,
// users, and visits (both backfilled history and live check-ins from the
// app). Every function file touches data only through here, so this is the
// one place to swap for a real DB later.

const { getStore } = require('@netlify/blobs');

// The zero-config getStore(name) relies on Netlify auto-injecting Blobs
// context, which isn't reliably present for every function/runtime — it can
// fail with MissingBlobsEnvironmentError. Passing siteID + token explicitly
// (SITE_ID is auto-set by Netlify; NETLIFY_BLOBS_TOKEN is a Netlify personal
// access token you add under Site settings -> Environment variables) always
// works. Falls back to zero-config if the token isn't set yet.
function blobsStore(name) {
  const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  return siteID && token ? getStore({ name, siteID, token }) : getStore(name);
}

async function getStores(tenantCode) {
  const store = blobsStore(`stores-${tenantCode}`);
  return (await store.get('base', { type: 'json' })) || [];
}

async function getUsers(tenantCode) {
  const store = blobsStore(`users-${tenantCode}`);
  return (await store.get('list', { type: 'json' })) || [];
}

// Leegra's own internal staff roster — global, not scoped to a tenant.
// tier is one of 'super_user' | 'admin' | 'report_export_only'.
async function getStaff() {
  const store = blobsStore('leegra-staff');
  return (await store.get('list', { type: 'json' })) || [];
}

async function saveStaff(list) {
  const store = blobsStore('leegra-staff');
  await store.setJSON('list', list);
}

async function getImportedVisits(tenantCode) {
  const store = blobsStore(`visits-history-${tenantCode}`);
  const { blobs } = await store.list();
  const batches = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return batches.flat().filter(Boolean);
}

async function getLiveVisits(tenantCode) {
  const store = blobsStore(`visits-live-${tenantCode}`);
  const { blobs } = await store.list();
  const visits = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return visits.filter(Boolean);
}

// Normalizes live check-in records to the same flat shape the imported CSV
// history rows use. Only store_code/rep_email/checkin_at/checkout_at feed
// the dashboard aggregation below — per-visit question answers are dynamic
// per tenant (see questionnaires below) so they aren't part of this shape.
async function getAllVisits(tenantCode) {
  const [imported, live] = await Promise.all([getImportedVisits(tenantCode), getLiveVisits(tenantCode)]);
  const normalizedLive = live.map(v => ({
    store_code: v.storeCode,
    rep_email: v.repEmail,
    checkin_at: v.checkin_at,
    checkout_at: v.checkout_at || null,
  }));
  return [...imported, ...normalizedLive];
}

async function saveLiveVisit(tenantCode, visit) {
  const store = blobsStore(`visits-live-${tenantCode}`);
  await store.setJSON(visit.id, visit);
}

async function getLiveVisit(tenantCode, visitId) {
  const store = blobsStore(`visits-live-${tenantCode}`);
  return (await store.get(visitId, { type: 'json' })) || null;
}

async function getQuestionnaires(tenantCode) {
  const store = blobsStore(`questionnaires-${tenantCode}`);
  return (await store.get('list', { type: 'json' })) || [];
}

async function saveQuestionnaires(tenantCode, list) {
  const store = blobsStore(`questionnaires-${tenantCode}`);
  await store.setJSON('list', list);
}

// Picks the best-matching questionnaire for a check-in: an exact store match
// beats an exact visit-type match, which beats a tenant-wide default
// (one with no store_codes and no visit_type set). Returns null if nothing
// matches and there's no default.
function pickQuestionnaire(questionnaires, storeCode, visitType) {
  let best = null;
  let bestScore = -1;
  for (const q of questionnaires) {
    const storeMatch = Array.isArray(q.storeCodes) && q.storeCodes.length > 0 && q.storeCodes.includes(storeCode);
    const typeMatch = !!q.visitType && !!visitType && q.visitType === visitType;
    const isDefault = (!Array.isArray(q.storeCodes) || q.storeCodes.length === 0) && !q.visitType;
    if (!storeMatch && !typeMatch && !isDefault) continue;
    const score = (storeMatch ? 2 : 0) + (typeMatch ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function humanizeLastVisit(days) {
  if (days === null) return 'Never';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function statusFor(days) {
  if (days === null) return 'Not yet visited';
  if (days <= 3) return 'On track';
  if (days <= 6) return 'Due';
  return 'Overdue';
}

// Builds the dashboard shape the frontend expects, purely from real store +
// visit records. There's no separate "planned visit schedule" concept yet,
// so `completedPlanned` treats one visit per store as "planned". There's
// also no OOS flag captured on a visit yet, so `oosIssues` is always 0 —
// wire it up once that field exists on a visit task.
function computeDashboard(stores, visits) {
  const lastVisitByStore = {};
  for (const v of visits) {
    if (!v.store_code) continue;
    const prev = lastVisitByStore[v.store_code];
    if (!prev || new Date(v.checkin_at) > new Date(prev)) lastVisitByStore[v.store_code] = v.checkin_at;
  }

  const annotatedStores = stores.map(s => {
    const days = daysAgo(lastVisitByStore[s.code]);
    return { name: s.name, code: s.code, region: s.region, lastVisit: humanizeLastVisit(days), status: statusFor(days) };
  });

  const totalStores = stores.length;
  const visitedStoreCount = Object.keys(lastVisitByStore).length;
  const completedVisits = visits.filter(v => v.checkout_at).length;

  const byRep = {};
  for (const v of visits) {
    if (!v.rep_email) continue;
    byRep[v.rep_email] = byRep[v.rep_email] || { total: 0, done: 0 };
    byRep[v.rep_email].total += 1;
    if (v.checkout_at) byRep[v.rep_email].done += 1;
  }
  const leaderboard = Object.entries(byRep)
    .map(([email, s]) => ({ name: email, score: s.total ? `${Math.round((s.done / s.total) * 100)}%` : '0%', _sort: s.done }))
    .sort((a, b) => b._sort - a._sort)
    .slice(0, 10)
    .map((row, i) => ({ rank: i + 1, name: row.name, score: row.score }));

  return {
    compliance: totalStores ? `${Math.round((visitedStoreCount / totalStores) * 100)}%` : '0%',
    completedPlanned: `${completedVisits}/${totalStores}`,
    storesCovered: `${visitedStoreCount}/${totalStores}`,
    oosIssues: '0',
    stores: annotatedStores,
    leaderboard,
  };
}

module.exports = {
  blobsStore,
  getStores, getUsers, getAllVisits, saveLiveVisit, getLiveVisit, computeDashboard,
  getQuestionnaires, saveQuestionnaires, pickQuestionnaire,
  getStaff, saveStaff,
};
