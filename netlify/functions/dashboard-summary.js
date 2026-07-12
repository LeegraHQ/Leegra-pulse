// GET /api/dashboard-summary — tenant-scoped stats for the logged-in client.
// The tenant comes ONLY from the verified token, never from a query param.

const jwt = require('./_lib/jwt');
const { TENANTS } = require('./_data');

// Demo metrics keyed by tenant code — swap for real aggregation queries
// against your visits/stores tables once a DB is wired up.
const METRICS = {
  'PH-201': { compliance: '88%', completedPlanned: '132/150', storesCovered: '34/38', oosIssues: '5' },
  'SIR-014': { compliance: '92%', completedPlanned: '184/200', storesCovered: '42/45', oosIssues: '7' },
  'CIV-088': { compliance: '81%', completedPlanned: '97/120', storesCovered: '26/30', oosIssues: '11' },
  'BEU-305': { compliance: '90%', completedPlanned: '108/120', storesCovered: '22/24', oosIssues: '3' },
  'BRG-118': { compliance: '85%', completedPlanned: '119/140', storesCovered: '31/35', oosIssues: '6' },
  'SUP-042': { compliance: '94%', completedPlanned: '141/150', storesCovered: '29/30', oosIssues: '2' },
  'HAT-009': { compliance: '79%', completedPlanned: '62/80', storesCovered: '14/16', oosIssues: '4' },
  'TWR-260': { compliance: '87%', completedPlanned: '104/120', storesCovered: '25/28', oosIssues: '6' },
};

exports.handler = async (event) => {
  const claims = jwt.fromAuthHeader(event);
  if (!claims) return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  if (claims.role === 'leegra_super_admin') {
    return { statusCode: 200, body: JSON.stringify({ tenants: TENANTS.map(t => ({ ...t, ...METRICS[t.code] })) }) };
  }
  const metrics = METRICS[claims.tenantCode];
  if (!metrics) return { statusCode: 404, body: JSON.stringify({ error: 'Unknown tenant' }) };
  return { statusCode: 200, body: JSON.stringify(metrics) };
};
