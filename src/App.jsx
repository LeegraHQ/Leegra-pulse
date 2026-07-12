import React, { useState } from 'react';
import { login, getDashboardSummary, checkIn, checkOut, submitAnswer } from './api.js';
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
};

export default function App() {
  const [screen, setScreen] = useState('login'); // login | app | dashboard | superadmin
  const [session, setSession] = useState(null); // { token, role, client, isSuperAdmin }
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState('rep');

  const [visit, setVisit] = useState(null); // { id, checkedInAt, questionnaire: { id, name, questions } }
  const [answers, setAnswers] = useState({}); // { [questionId]: answer }
  const [visitError, setVisitError] = useState('');
  const [training, setTraining] = useState({ m1: false, m2: false, m3: false });

  async function handleSignIn(e) {
    e.preventDefault();
    try {
      const result = await login({ companyCode, email, password: '', role });
      if (LEEGRA_ROLES.includes(result.role)) {
        const { tenants } = await getDashboardSummary(result.token);
        setSession({ ...result, isSuperAdmin: true, tenants });
        setScreen('superadmin');
      } else {
        setSession({ ...result, isSuperAdmin: false });
        setScreen(result.role === 'field_rep' ? 'app' : 'dashboard');
      }
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

  function handleLogout() {
    setSession(null);
    setScreen('login');
    setCompanyCode('');
    setEmail('');
  }

  async function handleToggleCheckin() {
    if (!visit) {
      const store = session.client.stores[0];
      const v = await checkIn(session.token, store.code);
      setVisit({ id: v.id, checkedInAt: new Date(v.checkin_at), questionnaire: v.questionnaire });
      setAnswers({});
      setVisitError('');
    } else {
      try {
        await checkOut(session.token, visit.id);
        setVisit(null);
        setAnswers({});
        setVisitError('');
      } catch (err) {
        setVisitError(err.message);
      }
    }
  }

  async function handleAnswerChange(questionId, value) {
    setAnswers(a => ({ ...a, [questionId]: value }));
    if (visit) await submitAnswer(session.token, visit.id, questionId, value);
  }

  function handleToggleTraining(id) {
    setTraining(t => ({ ...t, [id]: !t[id] }));
  }

  if (screen === 'login') {
    return (
      <div className="lp-shell">
        <form className="lp-card" style={{ width: 360 }} onSubmit={handleSignIn}>
          <div className="lp-brand">Leegra Pulse</div>
          <div className="lp-slogan">Heartbeat of execution</div>

          <label className="lp-field">
            Email
            <input
              className="lp-input"
              placeholder="name@company.co.za"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
            />
          </label>

          <div className="lp-seg">
            <label className={role === 'rep' ? 'lp-seg-opt active' : 'lp-seg-opt'}>
              <input type="radio" name="role" checked={role === 'rep'} onChange={() => { setRole('rep'); setCompanyCode(''); setError(''); }} />
              Field rep
            </label>
            <label className={role === 'manager' ? 'lp-seg-opt active' : 'lp-seg-opt'}>
              <input type="radio" name="role" checked={role === 'manager'} onChange={() => { setRole('manager'); setCompanyCode(''); setError(''); }} />
              Manager / Admin
            </label>
          </div>

          <label className="lp-field">
            Client
            <select
              className="lp-input"
              value={companyCode}
              onChange={e => { setCompanyCode(e.target.value); setError(''); }}
            >
              <option value="" disabled>Select a client…</option>
              {TENANT_DIRECTORY.map(t => (
                <option key={t.code} value={t.code}>{t.name} ({t.code})</option>
              ))}
            </select>
          </label>

          {error && <div className="lp-error">{error}</div>}
          <div className="lp-muted" style={{ fontSize: 11 }}>Don't see your client listed? Contact your Leegra account manager.</div>

          <button className="lp-btn lp-btn-primary lp-block" type="submit">Sign in</button>
          <div className="lp-muted" style={{ textAlign: 'center', fontSize: 11 }}>Isolated per client — your login only ever sees your own client's data.</div>
        </form>
      </div>
    );
  }

  if (screen === 'superadmin') {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 820 }}>
          <div className="lp-nav">
            <div className="lp-nav-brand">Leegra Pulse · {LEEGRA_ROLE_LABELS[session.role] || 'Super admin'}</div>
            <div className="lp-tag lp-tag-accent">{session.email}</div>
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={handleLogout}>Log out</button>
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

  const client = session.client;

  if (screen === 'app') {
    const questions = visit?.questionnaire?.questions || [];
    const isAnswered = a => a !== undefined && a !== null && a !== '';
    const doneCount = questions.filter(q => isAnswered(answers[q.id])).length;
    if (!client.stores.length) {
      return (
        <div className="lp-shell">
          <div className="lp-card" style={{ width: 380 }}>
            <div className="lp-nav">
              {client.logo && <img src={client.logo} alt={client.name} height={22} />}
              <div className="lp-nav-brand">{client.name}</div>
              <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Log out</button>
            </div>
            <div className="lp-muted">No stores have been assigned to you yet — check with your manager.</div>
          </div>
        </div>
      );
    }
    const store = client.stores[0];
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 380 }}>
          <div className="lp-nav">
            {client.logo && <img src={client.logo} alt={client.name} height={22} />}
            <div className="lp-nav-brand">{client.name}</div>
            <button className="lp-tag lp-tag-outline" onClick={handleLogout}>Log out</button>
          </div>
          <div className="lp-muted">{client.staffName} · Field rep</div>

          <div className="lp-inner-card">
            <div className="lp-kicker">Today · Stop 1 of {client.repStoreCount}</div>
            <div className="lp-title">{store.name}</div>
            <div className="lp-meta">{store.code} · {store.region}</div>
            {visit && <span className="lp-tag lp-tag-accent2">Checked in {visit.checkedInAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>

          {!visit && <button className="lp-btn lp-btn-primary lp-block" onClick={handleToggleCheckin}>Check in — verify GPS</button>}

          {visit && (
            <>
              <button className="lp-btn lp-btn-secondary lp-block" disabled>✓ Checked in — GPS verified</button>
              <div className="lp-label">{visit.questionnaire?.name || 'Visit tasks'} · {doneCount}/{questions.length}</div>
              {!questions.length && <div className="lp-muted" style={{ fontSize: 12 }}>No checklist configured for this store yet.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {questions.map(q => {
                  const answer = answers[q.id];
                  if (q.type === 'boolean') {
                    return (
                      <div key={q.id} className="lp-row-card" onClick={() => handleAnswerChange(q.id, !answer)}>
                        <span className="lp-dot" style={{ background: answer ? 'var(--accent-2-400)' : 'var(--neutral-500)' }} />
                        <div style={{ flex: 1, fontSize: 13 }}>{q.label}{q.required ? ' *' : ''}</div>
                        <div className={answer ? 'lp-tag lp-tag-accent2' : 'lp-tag lp-tag-neutral'}>{answer ? 'Done' : 'Pending'}</div>
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
              <button className="lp-btn lp-btn-primary lp-block" onClick={handleToggleCheckin}>Check out</button>
            </>
          )}

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
        </div>
      </div>
    );
  }

  // dashboard
  return (
    <div className="lp-shell">
      <div className="lp-card" style={{ width: 860 }}>
        <div className="lp-nav">
          <div className="lp-nav-brand">Leegra Pulse</div>
          {client.logo && <img src={client.logo} alt={client.name} height={20} />}
          <div className="lp-tag lp-tag-accent">Client: {client.name}</div>
          <nav style={{ display: 'flex', gap: 16, marginLeft: 8 }}>
            <a href="#" aria-current="page">Overview</a>
            <a href="#">Stores</a>
            <a href="#">Staff</a>
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

        <div className="lp-grid-2">
          <div>
            <div className="lp-label">Store coverage</div>
            <table className="lp-table">
              <thead><tr><th>Store</th><th>Region</th><th>Last visit</th><th>Status</th></tr></thead>
              <tbody>
                {client.stores.map(s => (
                  <tr key={s.code}><td>{s.name}</td><td>{s.region}</td><td>{s.lastVisit}</td><td><span className="lp-tag lp-tag-outline">{s.status}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="lp-label">Staff leaderboard</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {client.leaderboard.map(row => (
                <div key={row.rank} className="lp-row-card">
                  <div style={{ flex: 1, fontSize: 13 }}>{row.rank} · {row.name}</div>
                  <div className="lp-tag lp-tag-accent">{row.score}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

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

        <div className="lp-muted" style={{ fontSize: 11 }}>Visible to {client.name} only — other clients' data is not queryable from this session.</div>
      </div>
    </div>
  );
}
