// GET /api/access-code — Leegra admin only.
// Shows the current month's code for each holder so you can read it out or resend it.
const jwt = require('./_lib/jwt');
const accessCode = require('./_lib/accesscode');
const { CODE_HOLDERS } = require('./_data');

exports.handler = async (event) => {
  const user = jwt.fromAuthHeader(event);
  if (!user || user.role !== 'leegra_super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Admins only' }) };
  }
  const holders = CODE_HOLDERS.map(h => ({
    email: h.email, name: h.name, tenantCode: h.tenantCode,
    code: accessCode.codeFor(h.tenantCode), month: accessCode.monthKey(),
  }));
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holders) };
};
