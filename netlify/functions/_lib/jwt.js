// Minimal signed-token helper so the demo doesn't need a JWT dependency.
// Replace with a real `jsonwebtoken` (npm) + a secret in Netlify env vars
// (`JWT_SECRET`) for production — the shape (sign/verify) stays the same so
// nothing else needs to change.

const crypto = require('crypto');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
}

function fromAuthHeader(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return verify(token);
}

module.exports = { sign, verify, fromAuthHeader };
