// GET /api/civvio-execution            (Authorization: Bearer <token from /api/auth-login>)
//   → { stores, visits, superUser, views? }   DMQ Monthly Stand Check data for CIV-088
// GET /api/civvio-execution?log=1      → same, and logs one dashboard view
// GET /api/civvio-execution?photo=<id>&t=<token>  → one rep photo (token in query so <img> works)
//
// Who can read: the DMQ dashboard login (any CIV-088 non-rep user) and Leegra
// staff (Chris, Nikki, Gordon). Staff are "super users": they also get the
// view log.

const jwt = require('./_lib/jwt');
const { LEEGRA_ROLES } = require('./_data');
const { blobsStore, getLiveVisits, getStores, getUsers, getPhoto } = require('./_lib/records');

const supa = require('./_lib/supabase');
const TENANT = 'CIV-088';
const SAST_MS = 2 * 60 * 60 * 1000;
const pad = n => String(n).padStart(2, '0');
const local = iso => new Date(new Date(iso).getTime() + SAST_MS);
const datePart = iso => local(iso).toISOString().slice(0, 10);
const timePart = iso => { const d = local(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const validIso = iso => !!iso && !isNaN(new Date(iso).getTime());
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const nameFromEmail = e => String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const yn = v => (v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '' : String(v));

function claimsFrom(event, qsToken) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || (qsToken ? 'Bearer ' + qsToken : '');
  return auth ? jwt.fromAuthHeader({ headers: { authorization: auth, Authorization: auth } }) : null;
}

function access(claims) {
  if (!claims) return null;
  if (LEEGRA_ROLES.includes(claims.role)) return { superUser: true };
  if (claims.tenantCode === TENANT && claims.role !== 'field_rep') return { superUser: false };
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  const qs = event.queryStringParameters || {};
  const claims = claimsFrom(event, qs.t);
  const who = access(claims);
  if (!who) return json(401, { error: 'Sign in again' });

  if (qs.photo) {
    const photo = await getPhoto(TENANT, String(qs.photo).replace(/[^\w-]/g, '')).catch(() => null);
    if (!photo) return { statusCode: 404, body: 'Photo not found' };
    return { statusCode: 200, headers: { 'Content-Type': photo.mime || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }, isBase64Encoded: true, body: Buffer.from(photo.bytes).toString('base64') };
  }

  const viewStore = blobsStore(`report-views-${TENANT}`);
  if (qs.log === '1') {
    const at = new Date().toISOString();
    const id = `${at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    await viewStore.setJSON(id, { id, email: claims.email || 'unknown', at }).catch(() => {});
  }

  const [visits, stores, users] = await Promise.all([getLiveVisits(TENANT), getStores(TENANT), getUsers(TENANT)]);
  const storeBy = Object.fromEntries(stores.map(s => [s.code, s]));
  const nameBy = Object.fromEntries(users.filter(u => u.email && u.name).map(u => [u.email.toLowerCase(), u.name]));

  const out = [];
  for (const v of visits) {
    if (!v || !validIso(v.checkin_at)) continue;
    if (!(v.questions || []).some(q => q.id === 'dmq_facings')) continue;
    const a = v.answers || {};
    const s = storeBy[v.storeCode] || {};
    const photos = ['dmq_stand_photo', 'dmq_extra_photo']
      .map(k => a[k]).filter(p => p && p.photoId)
      .map(p => ({ id: p.photoId, takenAt: validIso(p.takenAt) ? p.takenAt : v.checkin_at }));
    out.push({
      id: v.id, storeCode: v.storeCode || '', storeName: s.name || v.storeCode || '',
      channel: s.channel || 'Other', region: s.region || 'Unassigned',
      rep: nameBy[String(v.repEmail || '').toLowerCase()] || nameFromEmail(v.repEmail),
      date: datePart(v.checkin_at), time: timePart(v.checkin_at), done: validIso(v.checkout_at),
      facings: a.dmq_facings === '' || a.dmq_facings == null || isNaN(Number(a.dmq_facings)) ? null : Number(a.dmq_facings),
      returns: yn(a.dmq_returns), damaged: yn(a.dmq_damaged), additional: yn(a.dmq_additional_stock),
      comment: typeof a.dmq_comment === 'string' ? a.dmq_comment.slice(0, 1000) : '',
      photos,
    });
  }
  // Past visits uploaded from the Excel template (civvio-history.js).
  try {
    const hist = blobsStore(`civvio-history-${TENANT}`);
    const { blobs } = await hist.list();
    const batches = await Promise.all(blobs.map(b => hist.get(b.key, { type: 'json' }).catch(() => null)));
    batches.forEach((b, bi) => (b && Array.isArray(b.rows) ? b.rows : []).forEach((r, i) => {
      const s = storeBy[r.storeCode] || {};
      out.push({
        id: `hist-${bi}-${i}`, source: 'history', storeCode: r.storeCode, storeName: s.name || r.storeName || r.storeCode,
        channel: s.channel || r.channel || 'Other', region: s.region || r.region || 'Unassigned',
        rep: r.rep || s.plannedRep || '', date: r.date, time: '', done: true,
        facings: r.facings, returns: r.returns || '', damaged: r.damaged || '', additional: r.additional || '',
        comment: r.comment || '', photos: [],
      });
    }));
  } catch (e) { console.error('civvio history read failed', e && e.message); }
  out.sort((x, y) => (x.date + x.time < y.date + y.time ? 1 : -1));

  let views;
  if (who.superUser) {
    try {
      const { blobs } = await viewStore.list();
      const rows = (await Promise.all(blobs.map(b => viewStore.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
      const by = {};
      for (const r of rows) {
        const p = by[r.email] || (by[r.email] = { email: r.email, count: 0, last: null });
        p.count++; if (!p.last || r.at > p.last) p.last = r.at;
      }
      views = Object.values(by).sort((a, b) => (a.last < b.last ? 1 : -1));
    } catch { views = []; }
  }

  return json(200, {
    generatedAt: new Date().toISOString(),
    superUser: who.superUser,
    photoStorage: supa.configured() ? 'supabase' : 'netlify',
    stores: stores.filter(s => s.dmqMonthly).map(s => ({ code: s.code, name: s.name, channel: s.channel || 'Other', region: s.region || 'Unassigned', plannedRep: s.plannedRep || '' })),
    visits: out,
    views,
  });
};
