// Thin API seam. USE_MOCK=true resolves against the local mock CLIENTS array
// so the app runs standalone. Flip to false once the Netlify Functions
// backend (netlify/functions/) is deployed alongside this app — same-site
// relative /api/* calls work in both `netlify dev` and production with no
// extra config, since netlify.toml redirects /api/* to the functions.

import { CLIENTS, TRAINING_MATERIALS, SUPER_ADMIN_EMAIL } from './clients.js';

const USE_MOCK = false; // flip to true to run standalone against src/clients.js only
const API_BASE = '/api';

function genericClient(code) {
  const name = code.trim() ? `Client ${code.trim().toUpperCase()}` : 'Demo Client';
  return {
    code, name, logo: null, staffName: 'Demo Rep', staffEmail: 'demo.rep@client.co.za', repStoreCount: 2,
    compliance: '86%', completedPlanned: '110/128', storesCovered: '28/32', oosIssues: '5',
    stores: [
      { name: 'Store 1', code: 'STR-001', region: 'Region A', lastVisit: 'Today', status: 'On track' },
      { name: 'Store 2', code: 'STR-002', region: 'Region A', lastVisit: 'Yesterday', status: 'On track' },
      { name: 'Store 3', code: 'STR-003', region: 'Region B', lastVisit: '3 days ago', status: 'Due' },
      { name: 'Store 4', code: 'STR-004', region: 'Region B', lastVisit: '6 days ago', status: 'Overdue' },
    ],
    leaderboard: [ { rank: 1, name: 'Demo Rep', score: '92%' }, { rank: 2, name: 'Staff B', score: '87%' }, { rank: 3, name: 'Staff C', score: '81%' } ],
  };
}

export async function login({ companyCode, email, securityCode, role }) {
  if (USE_MOCK) {
    if (email.trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
      return { token: 'mock-token', role: 'leegra_super_admin', email: email.trim().toLowerCase() };
    }
    const client = CLIENTS.find(c => c.code.toLowerCase() === companyCode.trim().toLowerCase()) || genericClient(companyCode);
    return { token: 'mock-token', role: role === 'rep' ? 'field_rep' : 'client_admin', client };
  }
  const res = await fetch(`${API_BASE}/auth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_code: companyCode, email, security_code: securityCode }),
  });
  if (!res.ok) throw new Error('Invalid company code or credentials');
  return res.json(); // { token, role, client }
}

export async function getDashboardSummary(token, tenantCode) {
  if (USE_MOCK) {
    if (tenantCode) return CLIENTS.find(c => c.code === tenantCode) || genericClient(tenantCode);
    return {
      tenants: CLIENTS.map(c => ({
        code: c.code, name: c.name, logo: c.logo,
        compliance: c.compliance, completedPlanned: c.completedPlanned, storesCovered: c.storesCovered, oosIssues: c.oosIssues,
      })),
    };
  }
  const qs = tenantCode ? `?tenant_code=${encodeURIComponent(tenantCode)}` : '';
  const res = await fetch(`${API_BASE}/dashboard-summary${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Could not load dashboard');
  return res.json();
}

// Fallback questionnaire used only under USE_MOCK, so the rep screen still
// has something to render standalone. Real questionnaires are tenant-defined
// via POST /api/admin-questionnaire-import.
const MOCK_QUESTIONNAIRE = {
  id: 'mock-questionnaire',
  name: 'Standard visit',
  questions: [
    { id: 'photo', label: 'Shelf photo capture', type: 'boolean', required: true },
    { id: 'stock', label: 'Stock count / OOS report', type: 'boolean', required: true },
    { id: 'checklist', label: 'Planogram checklist', type: 'boolean', required: false },
    { id: 'survey', label: 'Manager survey', type: 'boolean', required: false },
  ],
};

export async function checkIn(token, storeId, visitType) {
  if (USE_MOCK) return { id: 'mock-visit', checkin_at: new Date().toISOString(), questionnaire: MOCK_QUESTIONNAIRE };
  const res = await fetch(`${API_BASE}/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ store_id: storeId, visit_type: visitType }),
  });
  return res.json();
}

export async function checkOut(token, visitId) {
  if (USE_MOCK) return { checkout_at: new Date().toISOString() };
  const res = await fetch(`${API_BASE}/visits-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ visit_id: visitId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.missing ? `Answer required: ${data.missing.join(', ')}` : (data.error || 'Could not check out'));
  return data;
}

export async function submitAnswer(token, visitId, questionId, answer) {
  if (USE_MOCK) return { ok: true };
  const res = await fetch(`${API_BASE}/visits-task`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ visit_id: visitId, question_id: questionId, answer }),
  });
  return res.json();
}

export async function getLearningMaterials(token) {
  if (USE_MOCK) return TRAINING_MATERIALS;
  const res = await fetch(`${API_BASE}/learning-materials`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

export async function uploadLearningMaterial(token, file) {
  if (USE_MOCK) return { ok: true, id: 'mock-material' };
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/learning-materials`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.json();
}
