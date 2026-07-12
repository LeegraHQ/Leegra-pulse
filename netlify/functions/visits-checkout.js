const jwt = require('./_lib/jwt');

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  return { statusCode: 200, body: JSON.stringify({ checkout_at: new Date().toISOString() }) };
};
