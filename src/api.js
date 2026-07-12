// Thin API seam. USE_MOCK=true resolves against the local mock CLIENTS array
// so the app runs standalone. Flip to false once the Netlify Functions
// backend (netlify/functions/) is deployed alongside this app — same-site
// relative /api/* calls work in both `netlify dev` and production with no
// extra config, since netlify.toml redirects /api/* to the functions.

import { CLIENTS, TRAINING_MATERIALS } from './clients.js';

const USE_MOCK = true; // flip to false once the Netlify Functions backend is live
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

export async function login({ companyCode, email, password, role }) {
  if (USE_MOCK) {
    const client = CLIENTS.find(c => c.code.toLowerCase() === companyCode.trim().toLowerCase()) || genericClient(companyCode);
    return { token: 'mock-token', role, client };
  }
  const res = await fetch(`${API_BASE}/auth-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_code: companyCode, email, password }),
  });
  if (!res.ok) throw new Error('Invalid company code or credentials');
  return res.json(); // { token, role, client }
}

export async function checkIn(token, storeId) {
  if (USE_MOCK) return { id: 'mock-visit', checkin_at: new Date().toISOString() };
  const res = await fetch(`${API_BASE}/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ store_id: storeId }),
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
  return res.json();
}

export async function updateVisitTask(token, visitId, type, payload) {
  if (USE_MOCK) return { ok: true };
  const res = await fetch(`${API_BASE}/visits-task`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ visit_id: visitId, type, payload }),
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
