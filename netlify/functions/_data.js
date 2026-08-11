// Shared config for the Netlify Functions: the tenant directory, the fail-safe
// super user, the Leegra staff role tiers, and the people who sign in with a
// monthly access code. Everything transactional (visits, photos, metrics)
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

// Monthly-code holders: they sign in with a code alone — no email, no OTP.
// The code itself is ACCESS_CODE_CURRENT in the Netlify env vars; change it on
// the 1st of each month (see _lib/accesscode.js).
// Alys sees Civvio read-only. Chris signs in with the same code but lands as
// super admin, so he can edit store calls and upload photos without going
// through the email OTP.
const CODE_HOLDERS = [
  { email: 'alys@dmq.co.za', name: 'Alys', tenantCode: 'CIV-088', role: 'client_viewer' },
  { email: 'chris@leegra.co.za', name: 'Chris', tenantCode: 'CIV-088', role: 'leegra_super_admin' },
];

function findTenantByCode(code) {
  return TENANTS.find(t => t.code.toLowerCase() === String(code || '').trim().toLowerCase());
}

module.exports = { TENANTS, SUPER_ADMIN_EMAIL, TIER_TO_ROLE, LEEGRA_ROLES, LEEGRA_WRITE_ROLES, CODE_HOLDERS, findTenantByCode };
