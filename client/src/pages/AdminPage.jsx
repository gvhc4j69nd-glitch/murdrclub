import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext.jsx';
import { REGIONS, regionName } from '../lib/regions';

export default function AdminPage() {
  const { user } = useAuth();
  const [pending, setPending] = useState([]);
  const [notAdmin, setNotAdmin] = useState(false);
  const [error, setError] = useState('');
  const [admins, setAdmins] = useState([]);
  const [assignForm, setAssignForm] = useState({ username: '', region_key: REGIONS[0].key });
  const [assignError, setAssignError] = useState('');

  function loadPending() {
    api
      .get('/admin/pending')
      .then(({ cases }) => { setPending(cases); setNotAdmin(false); })
      .catch(err => {
        if (err.message.includes('admin')) setNotAdmin(true);
        else setError(err.message);
      });
  }

  function loadAdmins() {
    if (!user?.is_superadmin) return;
    api.get('/admin/region-admins').then(({ admins }) => setAdmins(admins)).catch(() => {});
  }

  useEffect(() => { loadPending(); loadAdmins(); }, [user]);

  async function review(caseId, action) {
    try {
      await api.post(`/admin/cases/${caseId}/${action}`, {});
      setPending(p => p.filter(c => c.id !== caseId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function assignAdmin(e) {
    e.preventDefault();
    setAssignError('');
    try {
      await api.post('/admin/region-admins', assignForm);
      setAssignForm({ username: '', region_key: REGIONS[0].key });
      loadAdmins();
    } catch (err) {
      setAssignError(err.message);
    }
  }

  async function removeAdmin(id) {
    await api.del(`/admin/region-admins/${id}`);
    loadAdmins();
  }

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ marginBottom: 20 }}>Admin</h1>

      {error && <div className="error-banner">{error}</div>}

      {notAdmin ? (
        <div className="empty-state">You aren't a regional admin for any region yet.</div>
      ) : (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 10 }}>Pending case suggestions ({pending.length})</h3>
          {pending.length === 0 && <div className="empty-state">Nothing waiting on review.</div>}
          {pending.map(c => (
            <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{c.title}</div>
                  <div className="case-meta">
                    <span>{c.region_name}</span>
                    <span>Suggested by {c.submitted_by_username}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => review(c.id, 'approve')}>Approve</button>
                  <button className="btn btn-sm btn-danger" onClick={() => review(c.id, 'reject')}>Reject</button>
                </div>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>{c.summary}</p>
            </div>
          ))}
        </div>
      )}

      {user?.is_superadmin && (
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Regional admins</h3>
          <form onSubmit={assignAdmin} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {assignError && <div className="error-banner" style={{ flexBasis: '100%' }}>{assignError}</div>}
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Username</label>
              <input value={assignForm.username} onChange={e => setAssignForm(f => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Region</label>
              <select value={assignForm.region_key} onChange={e => setAssignForm(f => ({ ...f, region_key: e.target.value }))}>
                {REGIONS.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </div>
            <button className="btn btn-primary">Assign</button>
          </form>

          {admins.length === 0 && <div className="empty-state">No regional admins assigned yet.</div>}
          {admins.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{a.username} — {regionName(a.region_key)}</span>
              <button className="btn btn-sm btn-danger" onClick={() => removeAdmin(a.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
