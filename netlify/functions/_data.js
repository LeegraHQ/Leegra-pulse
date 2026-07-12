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

// Fixed fail-safe super user — always works even if the dynamic staff
// roster (see _lib/records.js's getStaff/saveStaff) is empty or misconfigured.
// Every other Leegra staff member's access tier lives in that roster instead,
// managed via admin-staff-assign.js.
const SUPER_ADMIN_EMAIL = 'chris@leegra.co.za';

// A staff roster tier maps to one of these JWT roles. leegra_super_admin and
// leegra_admin can both read/write across every tenant; only
// leegra_super_admin can manage the staff roster itself (see
// admin-staff-assign.js). leegra_report_only can read across every tenant
// but can't call any admin-*-import endpoint.
const TIER_TO_ROLE = {
  super_user: 'leegra_super_admin',
  admin: 'leegra_admin',
  report_export_only: 'leegra_report_only',
};
const LEEGRA_ROLES = Object.values(TIER_TO_ROLE);
// Of the three, leegra_report_only is read-only — excluded from write access.
const LEEGRA_WRITE_ROLES = ['leegra_super_admin', 'leegra_admin'];

function findTenantByCode(code) {
  return TENANTS.find(t => t.code.toLowerCase() === String(code || '').trim().toLowerCase());
}

module.exports = { TENANTS, SUPER_ADMIN_EMAIL, TIER_TO_ROLE, LEEGRA_ROLES, LEEGRA_WRITE_ROLES, findTenantByCode };
