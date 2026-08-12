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

// ---------------------------------------------------------------------------
// Photos, metrics and access-code sign-in. These require the Supabase-backed
// Functions — see SUPABASE_SETUP.md. With USE_MOCK on they return local stubs
// so the UI is still clickable.

const MOCK_PHOTOS = [
  { id: 'p1', tenant_code: 'CIV-088', store_code: 'TOT-4021', scope: 'visit', month: '2026-07', caption: 'Totalsports Sandton — main gondola after reset', url: '', taken_at: '2026-07-14T09:20:00Z' },
  { id: 'p2', tenant_code: 'CIV-088', store_code: 'TOT-4021', scope: 'visit', month: '2026-07', caption: 'Same bay before the call', url: '', taken_at: '2026-07-14T08:05:00Z' },
  { id: 'p3', tenant_code: 'CIV-088', store_code: 'MRP-2210', scope: 'month', month: '2026-07', caption: 'Mr Price Sport Menlyn — end-cap activation', url: '', taken_at: '2026-07-09T11:40:00Z' },
];

export async function loginWithAccessCode(code) {
  if (USE_MOCK) {
    const client = CLIENTS.find(c => c.code === 'CIV-088');
    return { token: 'mock-token', role: 'client_viewer', readOnly: true, viewerName: 'Alys', client };
  }
  const res = await fetch(`${API_BASE}/auth-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_code: code }),
  });
  if (!res.ok) throw new Error('That code is not valid this month.');
  return res.json();
}

export async function getPhotos(token, { tenant, month, store, scope } = {}) {
  if (USE_MOCK) return MOCK_PHOTOS.filter(p => (!month || p.month === month) && (!store || p.store_code === store) && (!scope || p.scope === scope));
  const params = new URLSearchParams(Object.entries({ tenant, month, store, scope }).filter(([, v]) => v));
  const res = await fetch(`${API_BASE}/photos?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.json()).error || 'Could not load photos');
  return res.json();
}

// file: a File from an <input type="file">. Read as a data URL and posted as
// base64 — simplest path that works on Netlify Functions without multipart.
export async function uploadPhoto(token, { tenant, storeCode, visitDate, caption, scope, file }) {
  if (USE_MOCK) return { id: 'mock', caption, url: URL.createObjectURL(file) };
  const data_base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const res = await fetch(`${API_BASE}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      tenant, store_code: storeCode, visit_date: visitDate, caption, scope: scope || 'visit',
      filename: file.name, content_type: file.type, data_base64,
    }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  return res.json();
}

export async function deletePhoto(token, id) {
  if (USE_MOCK) return { ok: true };
  const res = await fetch(`${API_BASE}/photos?id=${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export async function getMetrics(token, tenant, month) {
  if (USE_MOCK) return [{ tenant_code: tenant, month: month || '2026-07', calls_completed: 44, calls_planned: 44, stores_covered: '44/44', avg_rating: 3.6 }];
  const params = new URLSearchParams(Object.entries({ tenant, month }).filter(([, v]) => v));
  const res = await fetch(`${API_BASE}/metrics?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error((await res.json()).error || 'Could not load metrics');
  return res.json();
}

export async function updateMetrics(token, payload) {
  if (USE_MOCK) return { ...payload };
  const res = await fetch(`${API_BASE}/metrics`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
  return res.json();
}

export async function getAccessCodes(token) {
  if (USE_MOCK) return [{ email: 'alys@dmq.co.za', name: 'Alys', tenantCode: 'CIV-088', code: 'K7QP-3XMD', month: '2026-08' }];
  const res = await fetch(`${API_BASE}/access-code`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Admins only');
  return res.json();
}
