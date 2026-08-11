// The access code.
//
// Two modes:
//   1. Manual (what Leegra uses): set ACCESS_CODE_CURRENT in the Netlify env
//      vars — e.g. 1105. That is the code, for every code holder, until you
//      change it. Change it on the 1st of the month and the old one stops
//      working immediately. ACCESS_CODE_PREVIOUS optionally keeps last
//      month's code alive for a few days (ACCESS_CODE_GRACE_DAYS) so nobody
//      is locked out mid-handover.
//   2. Derived (fallback, if ACCESS_CODE_CURRENT is not set): an HMAC of
//      "tenant|YYYY-MM" under ACCESS_CODE_SECRET, which rotates on the 1st
//      by itself with nothing to remember.
const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — read aloud over the phone
const SECRET = process.env.ACCESS_CODE_SECRET || 'dev-only-insecure-secret';

const clean = v => String(v || '').trim().toUpperCase().replace(/\s/g, '');

function monthKey(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function derivedCode(tenantCode, date) {
  const mac = crypto.createHmac('sha256', SECRET).update(tenantCode + '|' + monthKey(date)).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out.slice(0, 4) + '-' + out.slice(4);
}

// The code to show/send right now.
function codeFor(tenantCode, date) {
  const manual = clean(process.env.ACCESS_CODE_CURRENT);
  return manual || derivedCode(tenantCode, date);
}

function verify(tenantCode, supplied) {
  const given = clean(supplied);
  if (!given) return false;

  const manual = clean(process.env.ACCESS_CODE_CURRENT);
  if (manual) {
    if (given === manual) return true;
    // Grace window for the previous code, if one was left in place.
    const previous = clean(process.env.ACCESS_CODE_PREVIOUS);
    const grace = parseInt(process.env.ACCESS_CODE_GRACE_DAYS || '0', 10);
    if (previous && given === previous && grace > 0 && new Date().getUTCDate() <= grace) return true;
    return false;
  }

  if (given === derivedCode(tenantCode)) return true;
  const grace = parseInt(process.env.ACCESS_CODE_GRACE_DAYS || '0', 10);
  if (grace > 0 && new Date().getUTCDate() <= grace) {
    const prev = new Date();
    prev.setUTCDate(0); // last day of the previous month
    if (given === derivedCode(tenantCode, prev)) return true;
  }
  return false;
}

module.exports = { codeFor, verify, monthKey, derivedCode };
