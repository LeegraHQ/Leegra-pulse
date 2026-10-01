import React, { useState, useEffect } from 'react';
import { login, requestLoginCode, getDashboardSummary, checkIn, checkOut, submitAnswer, uploadPhotoAnswer, getVisitLog, downloadVisitLogExport, clearVisitHistory, getLoginStatus } from './api.js';
import { TRAINING_MATERIALS, TENANT_DIRECTORY } from './clients.js';
import './theme.css';

// The three tiers Leegra's own internal staff can hold (see
// admin-staff-assign.js) — all three can browse every client's dashboard;
// only leegra_super_admin/leegra_admin can also write (import stores/users/
// questionnaires), which this frontend never exposes anyway (those calls
// are API-only), so the UI doesn't need to distinguish further than this.
const LEEGRA_ROLES = ['leegra_super_admin', 'leegra_admin', 'leegra_report_only'];
const LEEGRA_ROLE_LABELS = {
  leegra_super_admin: 'Super user',
  leegra_admin: 'Admin',
  leegra_report_only: 'Report export only',
};

// Bespoke per-client report tools (static, unauthenticated, hosted under
// public/reports/ — see /reports/<slug>/). Not every client has one yet.
const CLIENT_REPORT_LINKS = {
  'PH-201': '/reports/philips/',
  'BRG-118': '/reports/bridgestone/',
  'TWR-260': '/reports/tower/',
  'HAT-009': '/reports/hatfield/',
  'SUP-042': '/reports/supaquick/',
  'SIR-014': '/reports/sirfruit/',
  'BEU-305': '/reports/beurer/',
  'CIV-088': '/reports/civvio/',
};

// The surveys a rep can start a visit with. The value is the visit_type sent
// to /api/visits, which the backend matches against each questionnaire's
// visitType (see _lib/records.js pickQuestionnaire) — so adding a survey here
// means loading a questionnaire with the same visit_type, and nothing else.
const VISIT_SURVEYS = [
  { value: 'stock_pricing', label: 'Stock Count & Pricing Feedback' },
  { value: 'execution_image', label: 'Execution (Image Report)' },
  { value: 'competitor_feedback', label: 'Competitor Feedback' },
  { value: 'snag_report', label: 'Snag Report' },
];

// --- session persistence -------------------------------------------------
// The signed token has no server-side expiry, so the ONLY thing that used to
// end a session was the page losing its React state — which mobile browsers
// do routinely: opening the camera for a photo, switching apps, or letting
// the screen sleep can discard the tab and reload it. That reload looked to
// reps like a random logout, and took any in-progress call with it. So the
// session, the current screen and the live visit (answers included) are
// mirrored into localStorage on every change and restored on boot.
const SESSION_KEY = 'lp_session_v1';

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / full quota — the app still works, just not across reloads */
  }
}

// Read once at load, not per render.
const BOOT = readStored(SESSION_KEY);

// ---- Store coverage helpers (last-visit merge from client report data) ----
function storeKey(name) {
  return String(name || '')
    .replace(/\s*-\s*[a-z]{0,3}\d{2,}\s*$/i, '') // drop trailing " - S204" style store code
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function toIsoDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const dt = new Date(s);
  return isNaN(dt) ? '' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function daysSinceIso(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  const then = new Date(y, mo - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now - then) / 86400000));
}
function humanDays(days) {
  if (days === null) return 'Never';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
function daysFromLabel(label) {
  if (!label || label === 'Never') return null;
  if (label === 'Today') return 0;
  if (label === 'Yesterday') return 1;
  const m = String(label).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}
function formatIso(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Overlays report-data visits on the server's store list: whichever source has
// the more recent visit wins, and the row gets a real date + recomputed status.
function mergeReportVisits(stores, reportVisits) {
  const keys = reportVisits ? Object.keys(reportVisits) : [];
  return stores.map(s => {
    let days = daysFromLabel(s.lastVisit);
    let out = { ...s, _days: days };
    if (days !== null) {
      const dt = new Date(); dt.setDate(dt.getDate() - days);
      out.lastVisitDate = dt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    if (!keys.length) return out;
    const k = storeKey(s.name);
    let hit = reportVisits[k];
    if (!hit && k.length > 5) {
      const alt = keys.find(x => x.length > 5 && (x.includes(k) || k.includes(x)));
      if (alt) hit = reportVisits[alt];
    }
    if (!hit) return out;
    const rDays = daysSinceIso(hit.iso);
    if (days !== null && days < rDays) return out; // app visit is newer
    days = rDays;
    const status = hit.done || s.status === 'Done' ? 'Done' : days <= 14 ? 'On track' : days <= 21 ? 'Pending' : 'Overdue';
    return { ...s, _days: days, lastVisit: humanDays(days), lastVisitDate: formatIso(hit.iso), status };
  }).sort((a, b) => {
    const rank = (x) => (x.status === 'Done' ? -1 : x._days === null ? 1e9 : x._days);
    return rank(b) - rank(a);
  });
}

export default function App() {
  const [screen, setScreen] = useState(BOOT?.session ? (BOOT.screen || 'login') : 'login'); // login | app | dashboard | superadmin
  const [session, setSession] = useState(BOOT?.session || null); // { token, role, client, isSuperAdmin }
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [tenantChoices, setTenantChoices] = useState(null); // set only for the shared demo account (assigned to multiple tenants)
  const [dashTab, setDashTab] = useState('overview'); // overview | stores | staff — client dashboard nav

  const [visit, setVisit] = useState(() => {
    const v = BOOT?.visit;
    return v ? { ...v, checkedInAt: new Date(v.checkedInAt) } : null;
  }); // { id, checkedInAt, questionnaire: { id, name, questions } }
  const [answers, setAnswers] = useState(() => BOOT?.answers || {}); // { [questionId]: answer }
  const [visitError, setVisitError] = useState('');
  const [callDone, setCallDone] = useState(''); // store name of the call just ended, shown on the store picker
  const [training, setTraining] = useState({ m1: false, m2: false, m3: false });

  const [visitLog, setVisitLog] = useState([]);
  const [visitLogLoading, setVisitLogLoading] = useState(false);
  const [visitLogError, setVisitLogError] = useState('');
  const [clearTenantCode, setClearTenantCode] = useState('');
  const [selectedStoreCode, setSelectedStoreCode] = useState(BOOT?.selectedStoreCode || '');
  const [visitType, setVisitType] = useState(BOOT?.visitType || ''); // '' = tenant's default questionnaire; set to pick a visit_type-scoped one instead (see pickQuestionnaire)

  const [loginStatus, setLoginStatus] = useState({ users: [], count: 0, loggedInCount: 0 });
  const [loginStatusLoading, setLoginStatusLoading] = useState(false);
  const [loginStatusError, setLoginStatusError] = useState('');

  // Store coverage filters + last-visit dates pulled from the client's full
  // report data (Philips: Blitz attendance rows), merged over the server's
  // app-only visit history so stores visited outside the app still show a date.
  const [storeFilter, setStoreFilter] = useState({ q: '', region: 'All', last: 'All', status: 'All' });
  const [reportVisits, setReportVisits] = useState(null); // { [normStoreKey]: { iso, done } }
  const reportClientCode = session?.client?.code;
  useEffect(() => {
    setReportVisits(null);
    if (reportClientCode !== 'PH-201') return;
    let cancelled = false;
    const rowsOf = (x) => (x && Array.isArray(x.attendance) ? x.attendance : []);
    Promise.all([
      fetch('/reports/philips/phillips_data.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/report-history?tenant=PH-201').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/report-feed?tenant=PH-201').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([base, history, live]) => {
      if (cancelled) return;
      const rows = [...rowsOf(base), ...rowsOf(history && history.sections), ...rowsOf(live)];
      const map = {};
      for (const r of rows) {
        const key = storeKey(r[7]);
        const iso = toIsoDate(r[1]);
        if (!key || !iso) continue;
        const prev = map[key];
        if (!prev || iso > prev.iso) map[key] = { iso, done: !!r[3] || (prev && prev.done) };
        else if (r[3]) prev.done = true;
      }
      setReportVisits(map);
    });
    return () => { cancelled = true; };
  }, [reportClientCode]);

  // Mirror everything needed to resume after a reload. Photo preview URLs are
  // per-page blob URLs, so they are dropped here — the photo itself is already
  // on the server, only the thumbnail is lost.
  useEffect(() => {
    if (!session) {
      writeStored(SESSION_KEY, null);
      return;
    }
    const strippedAnswers = {};
    for (const [k, v] of Object.entries(answers)) {
      if (Array.isArray(v)) {
        strippedAnswers[k] = v.map(row => {
          const out = {};
          for (const [fk, fv] of Object.entries(row || {})) {
            out[fk] = fv && typeof fv === 'object' ? { photoId: fv.photoId } : fv;
          }
          return out;
        });
      } else if (v && typeof v === 'object') {
        strippedAnswers[k] = { photoId: v.photoId };
      } else {
        strippedAnswers[k] = v;
      }
    }
    writeStored(SESSION_KEY, {
      session,
      screen,
      visit: visit ? { ...visit, checkedInAt: visit.checkedInAt.toISOString() } : null,
      answers: strippedAnswers,
      selectedStoreCode,
      visitType,
    });
  }, [session, screen, visit, answers, selectedStoreCode, visitType]);

  async function handleRequestCode(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSendingCode(true);
    setError('');
    try {
      await requestLoginCode(email);
      setOtpSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSignIn(e, tenantCode) {
    if (e) e.preventDefault();
    try {
      const result = await login({ email, code: otpCode, tenantCode });
      if (result.needsTenantChoice) {
        setTenantChoices(result.tenants);
        setError('');
        return;
      }
      if (LEEGRA_ROLES.includes(result.role)) {
        const { tenants } = await getDashboardSummary(result.token);
        setSession({ ...result, isSuperAdmin: true, tenants });
        setScreen('superadmin');
      } else {
        setSession({ ...result, isSuperAdmin: false });
        setScreen(result.role === 'field_rep' ? 'app' : 'dashboard');
      }
      setTenantChoices(null);
      setError('');
      setVisit(null);
      setAnswers({});
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleOpenClient(code) {
    const client = await getDashboardSummary(session.token, code);
    setSession(s => ({ ...s, client }));
    setScreen('dashboard');
  }

  async function handleOpenVisitLog() {
    setScreen('visitlog');
    setVisitLogLoading(true);
    setVisitLogError('');
    try {
      const { visits } = await getVisitLog(session.token);
      setVisitLog(visits);
    } catch (err) {
      setVisitLogError(err.message);
    } finally {
      setVisitLogLoading(false);
    }
  }

  async function handleOpenLoginStatus() {
    setScreen('loginstatus');
    setLoginStatusLoading(true);
    setLoginStatusError('');
    try {
      const data = await getLoginStatus(session.token);
      setLoginStatus(data);
    } catch (err) {
      setLoginStatusError(err.message);
    } finally {
      setLoginStatusLoading(false);
    }
  }

  async function handleExportVisitLog(format) {
    try {
      await downloadVisitLogExport(session.token, format);
    } catch (err) {
      setVisitLogError(err.message);
    }
  }

  async function handleClearVisitHistory(tenantCode) {
    if (!tenantCode) return;
    const tenantName = TENANT_DIRECTORY.find(t => t.code === tenantCode)?.name || tenantCode;
    if (!window.confirm(`Delete ALL check-in history for ${tenantName}? This can't be undone.`)) return;
    try {
      await clearVisitHistory(session.token, tenantCode);
      await handleOpenVisitLog();
    } catch (err) {
      setVisitLogError(err.message);
    }
  }

  function handleLogout() {
    writeStored(SESSION_KEY, null);
    setSession(null);
    setScreen('login');
    setEmail('');
    setOtpSent(false);
    setOtpCode('');
    setSelectedStoreCode('');
    setTenantChoices(null);
    setVisitType('');
    setVisit(null);
    setAnswers({});
    setCallDone('');
  }

  // End the call: check out, then drop the rep back on store selection with a
  // confirmation, session intact, ready to pick the next store.
  async function handleEndCall() {
    const storeName = (session.client.stores.find(s => s.code === selectedStoreCode) || session.client.stores[0])?.name || 'this store';
    try {
      if (visit) await checkOut(session.token, visit.id);
      handleExitStore();
      setCallDone(storeName);
    } catch (err) {
      setVisitError(err.message);
    }
  }

  // Leaving a store must NOT end the session — it checks out, then returns the rep to store selection.
  async function handleCheckOutAndLeave() {
    if (!visit) return handleExitStore();
    try {
      await checkOut(session.token, visit.id);
      handleExitStore();
      setCallDone('');
    } catch (err) {
      setVisitError(err.message);
    }
  }

  function handleExitStore() {
    setVisit(null);
    setAnswers({});
    setVisitError('');
    setVisitType('');
    setSelectedStoreCode('');
  }

  async function handleToggleCheckin() {
    if (!visit) {
      const stores = session.client.stores;
      const store = stores.find(s => s.code === selectedStoreCode) || stores[0];
      const v = await checkIn(session.token, store.code, visitType || undefined);
      setVisit({ id: v.id, checkedInAt: new Date(v.checkin_at), questionnaire: v.questionnaire });
      setAnswers({});
      setVisitError('');
      setCallDone('');
    } else {
      try {
        await checkOut(session.token, visit.id);
        handleExitStore();
      } catch (err) {
        setVisitError(err.message);
      }
    }
  }

  // --- repeating rows -----------------------------------------------------
  // A 'repeat' question's answer is an array of row objects keyed by field id
  // (one row per SKU line). The whole array is saved on every edit, so a
  // dropped connection mid-visit never leaves half a row on the server.
  function rowsOf(questionId) {
    const rows = answers[questionId];
    return Array.isArray(rows) ? rows : [];
  }

  async function saveRows(questionId, rows) {
    setAnswers(a => ({ ...a, [questionId]: rows }));
    if (visit) await submitAnswer(session.token, visit.id, questionId, rows);
  }

  function handleAddRow(q) {
    saveRows(q.id, [...rowsOf(q.id), {}]);
  }

  function handleRemoveRow(q, idx) {
    saveRows(q.id, rowsOf(q.id).filter((_, i) => i !== idx));
  }

  function handleCellChange(q, idx, fieldId, value) {
    saveRows(q.id, rowsOf(q.id).map((r, i) => (i === idx ? { ...r, [fieldId]: value } : r)));
  }

  async function handleCellPhoto(q, idx, field, file) {
    if (!visit || !file) return;
    const res = await uploadPhotoAnswer(session.token, visit.id, `${q.id}__${idx}__${field.id}`, file);
    handleCellChange(q, idx, field.id, { photoId: res.photo_id, previewUrl: res.previewUrl });
  }

  async function handleAnswerChange(questionId, value) {
    setAnswers(a => ({ ...a, [questionId]: value }));
    if (visit) await submitAnswer(session.token, visit.id, questionId, value);
  }

  async function handlePhotoAnswer(questionId, file) {
    if (!visit || !file) return;
    const result = await uploadPhotoAnswer(session.token, visit.id, questionId, file);
    setAnswers(a => ({ ...a, [questionId]: { photoId: result.photo_id, previewUrl: result.previewUrl } }));
  }

  function handleToggleTraining(id) {
    setTraining(t => ({ ...t, [id]: !t[id] }));
  }

  if (screen === 'login' && tenantChoices) {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 360 }}>
          <img src="/logos/leegra-logo.png" alt="Leegra" height={28} style={{ alignSelf: 'flex-start' }} />
          <div className="lp-brand">Leegra Pulse</div>
          <div className="lp-slogan">Choose which client to enter</div>

          {error && <div className="lp-error">{error}</div>}

          {tenantChoices.map(t => (
            <button
              key={t.code}
              className="lp-btn lp-btn-secondary lp-block"
              type="button"
              onClick={() => handleSignIn(null, t.code)}
            >
              {t.name}
            </button>
          ))}

          <button
            className="lp-btn lp-btn-secondary lp-block"
            type="button"
            onClick={() => { setTenantChoices(null); setOtpSent(false); setOtpCode(''); setError(''); }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'login') {
    return (
      <div className="lp-shell">
        <form className="lp-card" style={{ width: 360 }} onSubmit={otpSent ? handleSignIn : handleRequestCode}>
          <img src="/logos/leegra-logo.png" alt="Leegra" height={28} style={{ alignSelf: 'flex-start' }} />
          <div className="lp-brand">Leegra Pulse</div>
          <div className="lp-slogan">Heartbeat of execution</div>

          <label className="lp-field">
            Email
            <input
              className="lp-input"
              placeholder="name@company.co.za"
              value={email}
              disabled={otpSent}
              onChange={e => { setEmail(e.target.value); setError(''); }}
            />
          </label>

          {otpSent && (
            <label className="lp-field">
              Code
              <input
                className="lp-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Your 4-digit Leegra Pulse code"
                value={otpCode}
                onChange={e => { setOtpCode(e.target.value); setError(''); }}
                autoFocus
              />
            </label>
          )}

          {error && <div className="lp-error">{error}</div>}

          {!otpSent ? (
            <>
              <button className="lp-btn lp-btn-primary lp-block" type="submit" disabled={sendingCode}>
                {sendingCode ? 'Checking…' : 'Continue'}
              </button>
              <div className="lp-muted" style={{ textAlign: 'center', fontSize: 11 }}>
                Enter your work email, then the code Leegra sent you. It doesn't expire.
              </div>
            </>
          ) : (
            <>
              <button className="lp-btn lp-btn-primary lp-block" type="submit">Sign in</button>
              <button
                className="lp-btn lp-btn-secondary lp-block"
                type="button"
                onClick={() => { setOtpSent(false); setOtpCode(''); setError(''); }}
              >
                Use a different email
              </button>
            </>
          )}
        </form>
      </div>
    );
  }

  if (screen === 'superadmin') {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 820 }}>
          <div className="lp-nav">
            <img src="/logos/leegra-logo.png" alt="Leegra" height={20} />
            <div className="lp-nav-brand">Leegra Pulse · {LEEGRA_ROLE_LABELS[session.role] || 'Super admin'}</div>
            <div className="lp-tag lp-tag-accent">{session.email}</div>
            <a className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto', textDecoration: 'none' }} href="/reports/schedule/">Execution calendar</a>
            <button className="lp-tag lp-tag-outline" onClick={handleOpenVisitLog}>Visit Log</button>
            <button className="lp-tag lp-tag-outline" onClick={handleOpenLoginStatus}>Login Status</button>
            <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Log out</button>
          </div>
          <div className="lp-muted" style={{ fontSize: 12 }}>All client accounts — select one to view its dashboard.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {session.tenants.map(c => (
              <div key={c.code} className="lp-inner-card" style={{ cursor: 'pointer' }} onClick={() => handleOpenClient(c.code)}>
                <div className="lp-title" style={{ fontSize: 15 }}>{c.name}</div>
                <div className="lp-meta">{c.code}</div>
                <div className="lp-tag lp-tag-accent2">{c.compliance} compliance</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'visitlog') {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 980 }}>
          <div className="lp-nav">
            <img src="/logos/leegra-logo.png" alt="Leegra" height={20} />
            <div className="lp-nav-brand">Leegra Pulse · Visit Log</div>
            <div className="lp-tag lp-tag-accent">{session.email}</div>
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={() => setScreen('superadmin')}>All clients</button>
            <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Log out</button>
          </div>
          <div className="lp-muted" style={{ fontSize: 12 }}>Consolidated check-in/check-out log across every client.</div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="lp-btn lp-btn-secondary" onClick={() => handleExportVisitLog('xlsx')}>Export Excel</button>
            <button className="lp-btn lp-btn-secondary" onClick={() => handleExportVisitLog('pdf')}>Export PDF</button>
            <select
              className="lp-input"
              style={{ marginLeft: 'auto', width: 200 }}
              value={clearTenantCode}
              onChange={e => setClearTenantCode(e.target.value)}
            >
              <option value="">Clear history for…</option>
              {TENANT_DIRECTORY.map(t => (
                <option key={t.code} value={t.code}>{t.name} ({t.code})</option>
              ))}
            </select>
            <button
              className="lp-btn lp-btn-secondary"
              style={{ color: 'var(--accent-300)' }}
              disabled={!clearTenantCode}
              onClick={() => handleClearVisitHistory(clearTenantCode)}
            >
              Clear
            </button>
          </div>

          {visitLogError && <div className="lp-error">{visitLogError}</div>}
          {visitLogLoading && <div className="lp-muted">Loading…</div>}

          {!visitLogLoading && !visitLogError && (
            <table className="lp-table">
              <thead>
                <tr><th>Client</th><th>Store</th><th>Rep</th><th>Checked in</th><th>Checked out</th><th>Duration</th><th>Answers</th></tr>
              </thead>
              <tbody>
                {visitLog.map((v, i) => (
                  <tr key={i}>
                    <td>{v.tenantName}</td>
                    <td>{v.storeName}</td>
                    <td>{v.repEmail || '—'}</td>
                    <td>{v.checkinAt ? new Date(v.checkinAt).toLocaleString() : '—'}</td>
                    <td>{v.checkoutAt ? new Date(v.checkoutAt).toLocaleString() : '—'}</td>
                    <td>{v.durationMinutes != null ? `${v.durationMinutes} min` : '—'}</td>
                    <td style={{ fontSize: 11 }}>
                      {v.answers.map((a, j) => (
                        <span key={j} className="lp-tag lp-tag-neutral" style={{ marginRight: 4, marginBottom: 4 }}>
                          {a.label}: {a.photoId ? '📷' : String(a.value)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!visitLog.length && (
                  <tr><td colSpan={7} className="lp-muted" style={{ textAlign: 'center' }}>No visits recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'loginstatus') {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 900 }}>
          <div className="lp-nav">
            <img src="/logos/leegra-logo.png" alt="Leegra" height={20} />
            <div className="lp-nav-brand">Leegra Pulse · Login Status</div>
            <div className="lp-tag lp-tag-accent">{session.email}</div>
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={() => setScreen('superadmin')}>All clients</button>
            <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Log out</button>
          </div>
          <div className="lp-muted" style={{ fontSize: 12 }}>
            Every assigned client user, across every tenant you can see — who's actually logged in and when.
            {!loginStatusLoading && !loginStatusError && ` ${loginStatus.loggedInCount} of ${loginStatus.count} have logged in at least once.`}
          </div>

          {loginStatusError && <div className="lp-error">{loginStatusError}</div>}
          {loginStatusLoading && <div className="lp-muted">Loading…</div>}

          {!loginStatusLoading && !loginStatusError && (
            <table className="lp-table">
              <thead>
                <tr><th>Client</th><th>Email</th><th>Role</th><th>Last login</th><th>Fixed code set</th></tr>
              </thead>
              <tbody>
                {loginStatus.users.map((u, i) => (
                  <tr key={i}>
                    <td>{u.tenantName}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>
                      {u.lastLoginAt
                        ? <span className="lp-tag lp-tag-accent2">{new Date(u.lastLoginAt).toLocaleString()}</span>
                        : <span className="lp-tag lp-tag-neutral">Never logged in</span>}
                    </td>
                    <td>{u.hasFixedCode ? 'Yes' : '—'}</td>
                  </tr>
                ))}
                {!loginStatus.users.length && (
                  <tr><td colSpan={5} className="lp-muted" style={{ textAlign: 'center' }}>No users assigned yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const client = session.client;
  const coverageStores = mergeReportVisits(client?.stores || [], reportVisits);
  const regionOptions = ['All', ...[...new Set(coverageStores.map(s => s.region).filter(Boolean))].sort()];
  const statusOptions = ['All', ...[...new Set(coverageStores.map(s => s.status).filter(Boolean))].sort()];
  const filteredStores = coverageStores.filter(s => {
    const f = storeFilter;
    if (f.q && !String(s.name || '').toLowerCase().includes(f.q.trim().toLowerCase())) return false;
    if (f.region !== 'All' && s.region !== f.region) return false;
    if (f.status !== 'All' && s.status !== f.status) return false;
    if (f.last !== 'All') {
      const d = s._days;
      if (f.last === 'never' && d !== null) return false;
      if (f.last === '7' && !(d !== null && d <= 7)) return false;
      if (f.last === '30' && !(d !== null && d <= 30)) return false;
      if (f.last === 'over30' && !(d !== null && d > 30)) return false;
    }
    return true;
  });
  const setSF = (k) => (e) => { const v = e.target.value; setStoreFilter(f => ({ ...f, [k]: v })); };

  if (screen === 'app') {
    const questions = visit?.questionnaire?.questions || [];
    const isAnswered = a => (Array.isArray(a) ? a.length > 0 : a !== undefined && a !== null && a !== '');
    const doneCount = questions.filter(q => isAnswered(answers[q.id])).length;
    if (!client.stores.length) {
      return (
        <div className="lp-shell">
          <div className="lp-card" style={{ width: 380 }}>
            <div className="lp-nav">
              {client.logo && <img src={client.logo} alt={client.name} height={22} />}
              <div className="lp-nav-brand">{client.name}</div>
              <img src="/logos/leegra-logo.png" alt="Leegra" height={18} style={{ marginLeft: 'auto' }} />
              <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Sign out</button>
            </div>
            <div className="lp-muted">No stores have been assigned to you yet — check with your manager.</div>
          </div>
        </div>
      );
    }
    const store = client.stores.find(s => s.code === selectedStoreCode) || client.stores[0];
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 380 }}>
          <div className="lp-nav">
            {client.logo && <img src={client.logo} alt={client.name} height={22} />}
            <div className="lp-nav-brand">{client.name}</div>
            <img src="/logos/leegra-logo.png" alt="Leegra" height={18} style={{ marginLeft: 'auto' }} />
            {visit && (
              <button className="lp-tag lp-tag-outline" onClick={handleCheckOutAndLeave}>Check out and leave</button>
            )}
            <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Sign out</button>
          </div>
          <div className="lp-muted">{client.staffName} · Field rep · {client.repStoreCount} stores assigned</div>

          {!visit ? (
            <>
              {callDone && (
                <div className="lp-inner-card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="lp-dot" style={{ background: 'var(--accent-2-400)' }} />
                  <div style={{ flex: 1, fontSize: 13 }}>Call at {callDone} completed and submitted. Choose your next store.</div>
                </div>
              )}
              <label className="lp-field">
                Store
                <select
                  className="lp-input"
                  value={store.code}
                  onChange={e => setSelectedStoreCode(e.target.value)}
                >
                  {client.stores.map(s => (
                    <option key={s.code} value={s.code}>{s.name}{/^TBC-/.test(s.code) ? '' : ` (${s.code})`}{s.region ? ` · ${s.region}` : ''}</option>
                  ))}
                </select>
              </label>
              <label className="lp-field">
                Survey
                <select
                  className="lp-input"
                  value={visitType}
                  onChange={e => setVisitType(e.target.value)}
                >
                  <option value="" disabled>Choose a survey…</option>
                  {VISIT_SURVEYS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="lp-inner-card">
              <div className="lp-kicker">Checked in</div>
              <div className="lp-title">{store.name}</div>
              <div className="lp-meta">{/^TBC-/.test(store.code) ? 'Store code to follow' : store.code}{store.region ? ` · ${store.region}` : ''}</div>
              <span className="lp-tag lp-tag-accent2">Checked in {visit.checkedInAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}

          {!visit && (
            <button className="lp-btn lp-btn-primary lp-block" disabled={!visitType} onClick={handleToggleCheckin}>
              {visitType ? (callDone ? 'Start new call — verify GPS' : 'Check in — verify GPS') : 'Choose a store and survey to start a call'}
            </button>
          )}

          {visit && (
            <>
              <button className="lp-btn lp-btn-secondary lp-block" disabled>✓ Checked in — GPS verified</button>
              <div className="lp-label">{visit.questionnaire?.name || 'Visit tasks'} · {doneCount}/{questions.length}</div>
              {!questions.length && <div className="lp-muted" style={{ fontSize: 12 }}>No checklist configured for this store yet.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questions.map(q => {
                  const answer = answers[q.id];
                  if (q.type === 'repeat') {
                    const rows = Array.isArray(answer) ? answer : [];
                    const rowLabel = q.rowLabel || 'Row';
                    return (
                      <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rows.map((row, idx) => (
                          <div key={idx} className="lp-inner-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className="lp-kicker" style={{ marginBottom: 0 }}>{rowLabel} {idx + 1}</div>
                              <button
                                className="lp-tag lp-tag-outline"
                                style={{ marginLeft: 'auto' }}
                                onClick={() => handleRemoveRow(q, idx)}
                              >
                                Remove
                              </button>
                            </div>
                            {(q.fields || []).map(f => {
                              const cell = row?.[f.id];
                              if (f.type === 'boolean') {
                                return (
                                  <div key={f.id} className="lp-row-card" onClick={() => handleCellChange(q, idx, f.id, !cell)}>
                                    <span className="lp-dot" style={{ background: cell ? 'var(--accent-2-400)' : 'var(--neutral-500)' }} />
                                    <div style={{ flex: 1, fontSize: 13 }}>{f.label}{f.required ? ' *' : ''}</div>
                                    <div className={cell ? 'lp-tag lp-tag-accent2' : 'lp-tag lp-tag-neutral'}>{cell ? 'Yes' : 'No'}</div>
                                  </div>
                                );
                              }
                              if (f.type === 'photo') {
                                const photoCell = cell && typeof cell === 'object' ? cell : null;
                                return (
                                  <div key={f.id} className="lp-row-card" style={{ alignItems: 'center' }}>
                                    <div style={{ flex: 1, fontSize: 13 }}>{f.label}{f.required ? ' *' : ''}</div>
                                    {photoCell?.previewUrl && (
                                      <img src={photoCell.previewUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', marginRight: 8 }} />
                                    )}
                                    <label className="lp-tag lp-tag-outline" style={{ cursor: 'pointer' }}>
                                      {photoCell ? 'Retake' : 'Take photo'}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        style={{ display: 'none' }}
                                        onChange={e => handleCellPhoto(q, idx, f, e.target.files[0])}
                                      />
                                    </label>
                                  </div>
                                );
                              }
                              if (f.type === 'choice') {
                                return (
                                  <div key={f.id} className="lp-row-card">
                                    <div style={{ flex: 1, fontSize: 13 }}>{f.label}{f.required ? ' *' : ''}</div>
                                    <select
                                      className="lp-input"
                                      style={{ width: 140 }}
                                      value={cell || ''}
                                      onChange={e => handleCellChange(q, idx, f.id, e.target.value)}
                                    >
                                      <option value="" disabled>Choose…</option>
                                      {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  </div>
                                );
                              }
                              if (f.type === 'suggest') {
                                // Dropdown of known SKUs, but the rep can type any code not in the list yet.
                                const listId = `dl-${q.id}-${f.id}`;
                                return (
                                  <div key={f.id} className="lp-row-card">
                                    <div style={{ flex: 1, fontSize: 13 }}>{f.label}{f.required ? ' *' : ''}</div>
                                    <input
                                      className="lp-input"
                                      style={{ width: 140 }}
                                      list={listId}
                                      placeholder="Pick or type"
                                      value={cell ?? ''}
                                      onChange={e => handleCellChange(q, idx, f.id, e.target.value.toUpperCase())}
                                    />
                                    <datalist id={listId}>
                                      {(f.options || []).map(opt => <option key={opt} value={opt} />)}
                                    </datalist>
                                  </div>
                                );
                              }
                              return (
                                <div key={f.id} className="lp-row-card">
                                  <div style={{ flex: 1, fontSize: 13 }}>{f.label}{f.required ? ' *' : ''}</div>
                                  <input
                                    className="lp-input"
                                    style={{ width: 140 }}
                                    type={f.type === 'number' ? 'number' : 'text'}
                                    value={cell ?? ''}
                                    onChange={e => handleCellChange(q, idx, f.id, e.target.value)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        <button className="lp-btn lp-btn-secondary lp-block" onClick={() => handleAddRow(q)}>
                          + Add {rows.length ? 'another ' : ''}{rowLabel.toLowerCase()}
                        </button>
                      </div>
                    );
                  }
                  if (q.type === 'boolean') {
                    return (
                      <div key={q.id} className="lp-row-card" onClick={() => handleAnswerChange(q.id, !answer)}>
                        <span className="lp-dot" style={{ background: answer ? 'var(--accent-2-400)' : 'var(--neutral-500)' }} />
                        <div style={{ flex: 1, fontSize: 13 }}>{q.label}{q.required ? ' *' : ''}</div>
                        <div className={answer ? 'lp-tag lp-tag-accent2' : 'lp-tag lp-tag-neutral'}>{answer ? 'Done' : 'Pending'}</div>
                      </div>
                    );
                  }
                  if (q.type === 'photo') {
                    const photoAnswer = answer && typeof answer === 'object' ? answer : null;
                    return (
                      <div key={q.id} className="lp-row-card" style={{ alignItems: 'center' }}>
                        <div style={{ flex: 1, fontSize: 13 }}>{q.label}{q.required ? ' *' : ''}</div>
                        {photoAnswer?.previewUrl && (
                          <img src={photoAnswer.previewUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', marginRight: 8 }} />
                        )}
                        <label className="lp-tag lp-tag-outline" style={{ cursor: 'pointer' }}>
                          {photoAnswer ? 'Retake' : 'Take photo'}
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            style={{ display: 'none' }}
                            onChange={e => handlePhotoAnswer(q.id, e.target.files[0])}
                          />
                        </label>
                      </div>
                    );
                  }
                  if (q.type === 'choice') {
                    return (
                      <div key={q.id} className="lp-row-card">
                        <div style={{ flex: 1, fontSize: 13 }}>{q.label}{q.required ? ' *' : ''}</div>
                        <select className="lp-input" style={{ width: 140 }} value={answer || ''} onChange={e => handleAnswerChange(q.id, e.target.value)}>
                          <option value="" disabled>Choose…</option>
                          {(q.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </div>
                    );
                  }
                  return (
                    <div key={q.id} className="lp-row-card">
                      <div style={{ flex: 1, fontSize: 13 }}>{q.label}{q.required ? ' *' : ''}</div>
                      <input
                        className="lp-input"
                        style={{ width: 140 }}
                        type={q.type === 'number' ? 'number' : 'text'}
                        value={answer ?? ''}
                        onChange={e => handleAnswerChange(q.id, e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>
              {visitError && <div className="lp-error">{visitError}</div>}
              <button className="lp-btn lp-btn-primary lp-block" onClick={handleEndCall}>End call</button>
            </>
          )}

          {client.learningEnabled !== false && (
            <div>
              <div className="lp-label">Leegra Learning</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TRAINING_MATERIALS.map(m => (
                  <div key={m.id} className="lp-row-card" onClick={() => handleToggleTraining(m.id)}>
                    <span className="lp-dot" style={{ background: training[m.id] ? 'var(--accent-2-400)' : 'var(--neutral-500)' }} />
                    <div style={{ flex: 1, fontSize: 13 }}>{m.title}</div>
                    <div className={training[m.id] ? 'lp-tag lp-tag-accent2' : 'lp-tag lp-tag-neutral'}>{training[m.id] ? 'Completed' : 'Not started'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // dashboard
  return (
    <div className="lp-shell">
      <div className="lp-card" style={{ width: 860 }}>
        <div className="lp-nav">
          <img src="/logos/leegra-logo.png" alt="Leegra" height={20} />
          <div className="lp-nav-brand">Leegra Pulse</div>
          {client.logo && <img src={client.logo} alt={client.name} height={20} />}
          <div className="lp-tag lp-tag-accent">Client: {client.name}</div>
          <nav style={{ display: 'flex', gap: 16, marginLeft: 8 }}>
            <a href="#" aria-current={dashTab === 'overview' ? 'page' : undefined} style={dashTab === 'overview' ? undefined : { opacity: 0.6 }} onClick={(e) => { e.preventDefault(); setDashTab('overview'); }}>Overview</a>
            <a href="#" aria-current={dashTab === 'stores' ? 'page' : undefined} style={dashTab === 'stores' ? undefined : { opacity: 0.6 }} onClick={(e) => { e.preventDefault(); setDashTab('stores'); }}>Stores</a>
            <a href="#" aria-current={dashTab === 'staff' ? 'page' : undefined} style={dashTab === 'staff' ? undefined : { opacity: 0.6 }} onClick={(e) => { e.preventDefault(); setDashTab('staff'); }}>Staff</a>
          </nav>
          {CLIENT_REPORT_LINKS[client.code] && (
            <a className="lp-tag lp-tag-outline" href={CLIENT_REPORT_LINKS[client.code]} target="_blank" rel="noreferrer">
              View full report ↗
            </a>
          )}
          {session.isSuperAdmin ? (
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={() => setScreen('superadmin')}>All clients</button>
          ) : (
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={handleLogout}>Log out</button>
          )}
        </div>

        <div className="lp-grid-4">
          <div className="lp-inner-card"><div className="lp-kicker">Visit compliance</div><div className="lp-title lg">{client.compliance}</div></div>
          <div className="lp-inner-card"><div className="lp-kicker">Completed / planned</div><div className="lp-title lg">{client.completedPlanned}</div></div>
          <div className="lp-inner-card"><div className="lp-kicker">Stores covered</div><div className="lp-title lg">{client.storesCovered}</div></div>
          <div className="lp-inner-card"><div className="lp-kicker">Open OOS issues</div><div className="lp-title lg accent">{client.oosIssues}</div></div>
        </div>

        <div className={dashTab === 'overview' ? 'lp-grid-2' : undefined}>
          {(dashTab === 'overview' || dashTab === 'stores') && (
            <div>
              <div className="lp-label">Store coverage</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input className="lp-input" style={{ flex: '1 1 160px', minWidth: 0 }} placeholder="Search store" value={storeFilter.q} onChange={setSF('q')} />
                <select className="lp-input" style={{ width: 'auto' }} value={storeFilter.region} onChange={setSF('region')} aria-label="Region">
                  {regionOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All regions' : o}</option>)}
                </select>
                <select className="lp-input" style={{ width: 'auto' }} value={storeFilter.last} onChange={setSF('last')} aria-label="Last visited">
                  <option value="All">Any last visit</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="over30">Over 30 days ago</option>
                  <option value="never">Never visited</option>
                </select>
                <select className="lp-input" style={{ width: 'auto' }} value={storeFilter.status} onChange={setSF('status')} aria-label="Status">
                  {statusOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All statuses' : o}</option>)}
                </select>
                <div className="lp-muted" style={{ fontSize: 11 }}>{filteredStores.length} of {coverageStores.length}</div>
              </div>
              <table className="lp-table">
                <thead><tr><th>Store</th><th>Region</th><th>Last visit</th><th>Status</th></tr></thead>
                <tbody>
                  {filteredStores.map(s => {
                    const statusColor = s.status === 'Pending' ? '#e2a336' : s.status === 'Overdue' ? '#e2544a' : undefined;
                    return (
                      <tr key={s.code}>
                        <td>{s.name}</td>
                        <td>{s.region}</td>
                        <td>
                          {s.lastVisitDate || s.lastVisit}
                          {s.lastVisitDate && <div className="lp-muted" style={{ fontSize: 11 }}>{s.lastVisit}</div>}
                        </td>
                        <td>
                          <span
                            className="lp-tag lp-tag-outline"
                            style={statusColor ? { color: statusColor, borderColor: statusColor } : undefined}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(dashTab === 'overview' || dashTab === 'staff') && (
            <div>
              <div className="lp-label">Staff leaderboard — visit compliance</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {client.leaderboard.map(row => (
                  <div key={row.rank} className="lp-row-card">
                    <div style={{ flex: 1, fontSize: 13 }}>{row.rank} · {row.name}</div>
                    <div className="lp-tag lp-tag-accent">{row.score} compliance</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {client.learningEnabled !== false && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div className="lp-label" style={{ marginBottom: 0 }}>Leegra Learning — training material</div>
              <button className="lp-btn" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--accent)' }}>+ Upload material</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {TRAINING_MATERIALS.map(m => (
                <div key={m.id} className="lp-inner-card">
                  <div className="lp-title" style={{ fontSize: 14 }}>{m.title}</div>
                  <div className="lp-meta">{m.type} · {m.meta}</div>
                  <div className="lp-tag lp-tag-accent2">Assigned to all reps</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="lp-muted" style={{ fontSize: 11 }}>Visible to {client.name} only — other clients' data is not queryable from this session.</div>
      </div>
    </div>
  );
}
