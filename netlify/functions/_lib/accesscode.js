// Monthly access code, derived — not stored.
//
// The code for a given month is an HMAC of "tenant|YYYY-MM" under ACCESS_CODE_SECRET,
// rendered as 8 unambiguous characters. Consequences:
//   * it changes automatically at 00:00 on the 1st of every month;
//   * last month's code stops working on its own (no revocation step);
//   * nothing needs to be written to a database for it to work;
//   * regenerating it (to email it) is deterministic, so the scheduled job and
//     the login check always agree.
// Set ACCESS_CODE_SECRET in Netlify env vars to a long random string. Changing
// that secret invalidates every outstanding code immediately.
const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — read aloud over the phone
const SECRET = process.env.ACCESS_CODE_SECRET || 'dev-only-insecure-secret';

function monthKey(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function codeFor(tenantCode, date) {
  const mac = crypto.createHmac('sha256', SECRET).update(tenantCode + '|' + monthKey(date)).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out.slice(0, 4) + '-' + out.slice(4); // e.g. K7QP-3XMD
}

// Accepts this month's code. Set ACCESS_CODE_GRACE_DAYS to allow last month's
// code for the first N days of a new month (default 0 — hard cutover).
function verify(tenantCode, supplied) {
  const clean = String(supplied || '').trim().toUpperCase().replace(/\s/g, '');
  if (!clean) return false;
  if (clean === codeFor(tenantCode)) return true;
  const grace = parseInt(process.env.ACCESS_CODE_GRACE_DAYS || '0', 10);
  if (grace > 0 && new Date().getUTCDate() <= grace) {
    const prev = new Date();
    prev.setUTCDate(0); // last day of previous month
    if (clean === codeFor(tenantCode, prev)) return true;
  }
  return false;
}

module.exports = { codeFor, verify, monthKey };
