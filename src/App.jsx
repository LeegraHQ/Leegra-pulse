import React, { useState } from 'react';
import { login, checkIn, checkOut, updateVisitTask } from './api.js';
import { CLIENTS, TRAINING_MATERIALS } from './clients.js';
import './theme.css';

const TASK_LABELS = {
  photo: 'Shelf photo capture',
  stock: 'Stock count / OOS report',
  checklist: 'Planogram checklist',
  survey: 'Manager survey',
};

const SUPER_ADMIN_EMAIL = 'chris@leegra.co.za';

export default function App() {
  const [screen, setScreen] = useState('login'); // login | app | dashboard | superadmin
  const [session, setSession] = useState(null); // { token, role, client, isSuperAdmin }
  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState('rep');

  const [visit, setVisit] = useState(null); // { id, checkedInAt }
  const [tasks, setTasks] = useState({ photo: false, stock: false, checklist: false, survey: false });
  const [training, setTraining] = useState({ m1: false, m2: false, m3: false });

  async function handleSignIn(e) {
    e.preventDefault();
    if (email.trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
      setSession({ isSuperAdmin: true, client: null });
      setScreen('superadmin');
      setError('');
      return;
    }
    try {
      const result = await login({ companyCode, email, password: '', role });
      setSession({ ...result, isSuperAdmin: false });
      setScreen(result.role === 'rep' ? 'app' : 'dashboard');
      setError('');
      setVisit(null);
      setTasks({ photo: false, stock: false, checklist: false, survey: false });
    } catch (err) {
      setError(err.message);
    }
  }

  function handleOpenClient(code) {
    const client = CLIENTS.find(c => c.code === code);
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
      setVisit({ id: v.id, checkedInAt: new Date(v.checkin_at) });
    } else {
      await checkOut(session.token, visit.id);
      setVisit(null);
      setTasks({ photo: false, stock: false, checklist: false, survey: false });
    }
  }

  async function handleToggleTask(key) {
    const next = { ...tasks, [key]: !tasks[key] };
    setTasks(next);
    if (visit) await updateVisitTask(session.token, visit.id, key, { completed: next[key] });
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

          <label className="lp-field">
            Company code
            <input
              className="lp-input"
              type="password"
              autoComplete="off"
              placeholder="Enter your company code"
              value={companyCode}
              onChange={e => { setCompanyCode(e.target.value); setError(''); }}
            />
          </label>

          {error && <div className="lp-error">{error}</div>}
          <div className="lp-muted" style={{ fontSize: 11 }}>Don't have your code? Contact your Leegra account manager.</div>

          <div className="lp-seg">
            <label className={role === 'rep' ? 'lp-seg-opt active' : 'lp-seg-opt'}>
              <input type="radio" name="role" checked={role === 'rep'} onChange={() => setRole('rep')} />
              Field rep
            </label>
            <label className={role === 'manager' ? 'lp-seg-opt active' : 'lp-seg-opt'}>
              <input type="radio" name="role" checked={role === 'manager'} onChange={() => setRole('manager')} />
              Manager
            </label>
          </div>

          <button className="lp-btn lp-btn-primary lp-block" type="submit">Sign in</button>
          <div className="lp-muted" style={{ textAlign: 'center', fontSize: 11 }}>10 clients · isolated by company code</div>
        </form>
      </div>
    );
  }

  if (screen === 'superadmin') {
    return (
      <div className="lp-shell">
        <div className="lp-card" style={{ width: 820 }}>
          <div className="lp-nav">
            <div className="lp-nav-brand">Leegra Pulse · Super admin</div>
            <div className="lp-tag lp-tag-accent">chris@leegra.co.za</div>
            <button className="lp-tag lp-tag-outline" style={{ marginLeft: 'auto' }} onClick={handleLogout}>Log out</button>
          </div>
          <div className="lp-muted" style={{ fontSize: 12 }}>All 8 client accounts — select one to view its dashboard.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {CLIENTS.map(c => (
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
    const doneCount = Object.values(tasks).filter(Boolean).length;
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
              <div className="lp-label">Visit tasks · {doneCount}/4</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.keys(TASK_LABELS).map(key => (
                  <div key={key} className="lp-row-card" onClick={() => handleToggleTask(key)}>
                    <span className="lp-dot" style={{ background: tasks[key] ? 'var(--accent-2-400)' : 'var(--neutral-500)' }} />
                    <div style={{ flex: 1, fontSize: 13 }}>{TASK_LABELS[key]}</div>
                    <div className={tasks[key] ? 'lp-tag lp-tag-accent2' : 'lp-tag lp-tag-neutral'}>{tasks[key] ? 'Done' : 'Pending'}</div>
                  </div>
                ))}
              </div>
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
