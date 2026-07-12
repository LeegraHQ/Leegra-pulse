// Shared in-memory seed data for the Netlify Functions. This stands in for a
// real database so the backend deploys and runs with zero setup. It resets
// whenever a function's container cold-starts — fine for a demo, NOT for
// production. Swap this file for a real Postgres client (Netlify DB / Neon,
// or Supabase) once you're ready; every function below only touches this
// module, so that's the one place to change.

const TENANTS = [
  { id: 't1', code: 'PH-201', name: 'Philips', logoUrl: '/logos/philips-logo.png' },
  { id: 't2', code: 'SIR-014', name: 'Sir Fruit', logoUrl: '/logos/sirfruit-logo.png' },
  { id: 't3', code: 'CIV-088', name: 'Civvio', logoUrl: '/logos/civvio-logo.png' },
  { id: 't4', code: 'BEU-305', name: 'Beurer', logoUrl: '/logos/beurer-logo.png' },
  { id: 't5', code: 'BRG-118', name: 'Bridgestone', logoUrl: '/logos/bridgestone-logo.png' },
  { id: 't6', code: 'SUP-042', name: 'Supa Quick', logoUrl: '/logos/supaquick-logo.png' },
  { id: 't7', code: 'HAT-009', name: 'Hatfield Motor Group', logoUrl: '/logos/hatfield-logo.png' },
  { id: 't8', code: 'TWR-260', name: 'Tower', logoUrl: null },
];

const SUPER_ADMIN_EMAIL = 'chris@leegra.co.za';

function findTenantByCode(code) {
  return TENANTS.find(t => t.code.toLowerCase() === String(code || '').trim().toLowerCase());
}

module.exports = { TENANTS, SUPER_ADMIN_EMAIL, findTenantByCode };
