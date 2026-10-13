// POST /api/admin-team-codes   { code: "<admin access code>", action?: "list" | "issue" | "reset", email? }
//
// Login codes for the Philips PH-201 team (field reps + client users).
//   list   – show every user on the tenant with their current fixed code
//   issue  – give a random 4-digit code to every user who has none (existing codes kept)
//   reset  – new code for one user (email required)
// Codes are fixedCode on the user record, which auth-login.js already accepts
// in place of the emailed OTP. No code is a literal in source.

const crypto = require('crypto');
const accessCode = require('./_lib/accesscode');
const { getUsers, saveUsers } = require('./_lib/records');
const ALLOC = require('./_philips-oct-allocation.json');

const TENANT = 'PH-201';
const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

function newCode(taken) {
  let c;
  do { c = String(crypto.randomInt(1000, 10000)); } while (taken.has(c));
  taken.add(c);
  return c;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!accessCode.isAdminCode((body.code || '').trim())) return json(403, { error: 'Admin code required' });

  const action = body.action || 'list';
  const users = await getUsers(TENANT);
  const taken = new Set(users.map(u => u.fixedCode).filter(Boolean));
  const allocNames = Object.fromEntries(ALLOC.reps.map(r => [r.email.toLowerCase(), r.name]));
  const changed = [];

  // Make sure every allocated rep exists as a user, so issue can give them a code.
  if (action === 'issue') {
    for (const r of ALLOC.reps) {
      if (!users.some(u => (u.email || '').toLowerCase() === r.email.toLowerCase())) {
        users.push({ email: r.email.toLowerCase(), name: r.name, role: 'field_rep', storeCodes: r.storeCodes || [], updatedAt: new Date().toISOString() });
      }
    }
    for (const u of users) {
      // Chris uses the shared access code by design — leave him alone.
      if (u.fixedCode || (u.email || '').toLowerCase() === 'chris@leegra.co.za') continue;
      u.fixedCode = newCode(taken);
      u.updatedAt = new Date().toISOString();
      changed.push(u.email);
    }
  } else if (action === 'reset') {
    const email = (body.email || '').trim().toLowerCase();
    const u = users.find(x => (x.email || '').toLowerCase() === email);
    if (!u) return json(404, { error: 'No user with that email on ' + TENANT });
    u.fixedCode = newCode(taken);
    u.updatedAt = new Date().toISOString();
    changed.push(u.email);
  } else if (action !== 'list') {
    return json(400, { error: 'action must be list, issue or reset' });
  }

  if (changed.length) await saveUsers(TENANT, users);

  const team = users.map(u => ({
    name: u.name || allocNames[(u.email || '').toLowerCase()] || u.email.split('@')[0],
    email: u.email,
    role: u.role || 'field_rep',
    code: u.fixedCode || ((u.email || '').toLowerCase() === 'chris@leegra.co.za' ? 'shared access code' : '— none, run Issue'),
    stores: (u.storeCodes || []).length,
    changed: changed.includes(u.email),
  })).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  return json(200, { ok: true, tenant_code: TENANT, action, changed: changed.length, team });
};
