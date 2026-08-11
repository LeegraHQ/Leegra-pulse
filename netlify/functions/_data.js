// Tenant directory + the people who hold a monthly access code.
// TENANTS is static config; everything transactional (visits, photos, metrics)
// lives in Supabase — see SUPABASE_SETUP.md.

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

// Code holders: sign in with the monthly code alone — no email, no password.
// role 'client_viewer' is read-only and scoped to one tenant.
const CODE_HOLDERS = [
  { email: 'alys@dmq.co.za', name: 'Alys', tenantCode: 'CIV-088', role: 'client_viewer' },
];

function findTenantByCode(code) {
  return TENANTS.find(t => t.code.toLowerCase() === String(code || '').trim().toLowerCase());
}

module.exports = { TENANTS, SUPER_ADMIN_EMAIL, CODE_HOLDERS, findTenantByCode };
