// POST /api/admin-seed-philips   { code: "<admin access code>" }
//
// One-shot provisioning for the Philips (PH-201) Blitz team: writes the store
// base and the 9 field-rep logins from _philips-seed.json, so the team can
// sign in and check into stores today.
//
// Deliberately additive on stores — the store base MERGES by code, so running
// it twice is safe and it never removes stores or history. Rep store
// ALLOCATIONS, by contrast, are replaced from the seed (see below): the diary
// is the source of truth for what a rep may check into.
//
// Each rep gets:
//   - exactly the stores on their own 2026 call diary, matched to the master
//     store list, and nothing else — visits.js refuses a check-in to any store
//     not on the rep's list, so the diary IS the permission boundary
//   - an "Off Diary Call" store of their own, for visits not on the diary
//   - their OWN persistent fixedCode instead of an emailed OTP (see
//     auth-login.js), so nobody is blocked waiting for a one-time code to
//     arrive. Codes are per-rep, not shared: a code identifies one person, so
//     a leaked code can be rotated for that rep alone without disturbing
//     anyone else's login.
//
// Auth is the monthly admin access code in the body, not a JWT — this has to
// be runnable from a browser address bar / a single curl before anyone has a
// working login on this tenant.

const accessCode = require('./_lib/accesscode');
const { blobsStore, getUsers, saveUsers, getStaff, saveStaff } = require('./_lib/records');
const SEED = require('./_philips-seed.json');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!accessCode.isAdminCode((body.code || '').trim())) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admin code required' }) };
  }

  const tenantCode = SEED.tenantCode;

  // --- stores: merge by code, never replace the base -----------------------
  const storeBlob = blobsStore(`stores-${tenantCode}`);
  const existingStores = (await storeBlob.get('base', { type: 'json' })) || [];
  const byCode = new Map(existingStores.map(s => [s.code, s]));
  let storesAdded = 0;
  for (const s of SEED.stores) {
    if (!byCode.has(s.code)) storesAdded += 1;
    byCode.set(s.code, Object.assign({}, byCode.get(s.code), s));
  }
  await storeBlob.setJSON('base', [...byCode.values()]);

  // --- users: merge by email, but store allocation is AUTHORITATIVE ---------
  // A rep must only be able to check into stores on their own call diary, so
  // storeCodes is REPLACED from the seed rather than unioned with whatever was
  // there before — a re-run removes any store that has since left their diary.
  // (lastLoginAt and other fields on the record are preserved.)
  const existingUsers = await getUsers(tenantCode);
  const byEmail = new Map(existingUsers.map(u => [u.email.toLowerCase(), u]));
  let usersAdded = 0;
  for (const u of SEED.users) {
    const key = u.email.toLowerCase();
    const prev = byEmail.get(key);
    if (!prev) usersAdded += 1;
    byEmail.set(key, Object.assign({}, prev, u, {
      storeCodes: [...new Set(u.storeCodes)],
      updatedAt: new Date().toISOString(),
    }));
  }
  await saveUsers(tenantCode, [...byEmail.values()]);

  // --- Leegra staff: keep the super user on the roster ----------------------
  // A super_user token is unscoped (every tenant, every store) and is what the
  // dashboard work is done from, so this makes sure the account resolves even
  // if the staff roster blob is empty. Merged by email — an existing entry's
  // tier is never downgraded, and no other staff member is touched.
  let staffAdded = 0;
  if (Array.isArray(SEED.staff) && SEED.staff.length) {
    const staff = await getStaff();
    const staffByEmail = new Map(staff.map(s => [s.email.toLowerCase(), s]));
    for (const s of SEED.staff) {
      const key = s.email.toLowerCase();
      if (!staffByEmail.has(key)) staffAdded += 1;
      staffByEmail.set(key, Object.assign({}, staffByEmail.get(key), s));
    }
    await saveStaff([...staffByEmail.values()]);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      tenant_code: tenantCode,
      stores_added: storesAdded,
      stores_total: byCode.size,
      users_added: usersAdded,
      users_total: byEmail.size,
      staff_added: staffAdded,
      logins: SEED.users.map(u => ({
        name: u.name,
        email: u.email,
        code: u.fixedCode,
        stores: u.storeCodes.length,
      })),
    }),
  };
};
