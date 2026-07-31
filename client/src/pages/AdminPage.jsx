import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext.jsx';
import { REGIONS, regionName } from '../lib/regions';

const TABS = [
  { key: 'suggestions', label: 'Pending case suggestions' },
  { key: 'updates', label: 'Pending case updates' },
  { key: 'solve', label: 'Solve requests' },
];

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('suggestions');
  const [pending, setPending] = useState([]);
  const [pendingUpdates, setPendingUpdates] = useState({ analyses: [], contributions: [] });
  const [solveRequests, setSolveRequests] = useState([]);
  const [notAdmin, setNotAdmin] = useState(false);
  const [error, setError] = useState('');
  const [admins, setAdmins] = useState([]);
  const [assignForm, setAssignForm] = useState({ username: '', region_key: REGIONS[0].key });
  const [assignError, setAssignError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');

  function loadPending() {
    api
      .get('/admin/pending')
      .then(({ cases }) => { setPending(cases); setNotAdmin(false); })
      .catch(err => {
        if (err.message.includes('admin')) setNotAdmin(true);
        else setError(err.message);
      });
  }

  function loadPendingUpdates() {
    api
      .get('/admin/pending-updates')
      .then(setPendingUpdates)
      .catch(() => {});
  }

  function loadSolveRequests() {
    api
      .get('/admin/solve-requests')
      .then(({ solveRequests }) => setSolveRequests(solveRequests))
      .catch(() => {});
  }

  function loadAdmins() {
    if (!user?.is_superadmin) return;
    api.get('/admin/region-admins').then(({ admins }) => setAdmins(admins)).catch(() => {});
  }

  useEffect(() => { loadPending(); loadPendingUpdates(); loadSolveRequests(); loadAdmins(); }, [user]);

  async function review(caseId, action) {
    try {
      await api.post(`/admin/cases/${caseId}/${action}`, {});
      setPending(p => p.filter(c => c.id !== caseId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function moderateAnalysis(caseId, action) {
    try {
      await api.post(`/admin/cases/${caseId}/analysis/${action}`, {});
      setPendingUpdates(u => ({ ...u, analyses: u.analyses.filter(a => a.id !== caseId) }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function moderateContribution(contributionId, action) {
    try {
      await api.post(`/admin/contributions/${contributionId}/${action}`, {});
      setPendingUpdates(u => ({ ...u, contributions: u.contributions.filter(c => c.id !== contributionId) }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function reviewSolveRequest(requestId, action) {
    try {
      await api.post(`/admin/solve-requests/${requestId}/${action}`, {});
      setSolveRequests(r => r.filter(sr => sr.id !== requestId));
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

  async function importFromWikipedia() {
    setImportBusy(true);
    setImportError('');
    setImportResult(null);
    try {
      const result = await api.post('/admin/import/wikipedia', { limit: 50 });
      setImportResult(result);
      loadPending();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
    }
  }

  const updatesCount = pendingUpdates.analyses.length + pendingUpdates.contributions.length;
  const tabCounts = { suggestions: pending.length, updates: updatesCount, solve: solveRequests.length };

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ marginBottom: 20 }}>Admin</h1>

      {error && <div className="error-banner">{error}</div>}

      {notAdmin ? (
        <div className="empty-state">You aren't a regional admin for any region yet.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`admin-tab${tab === t.key ? ' active' : ''}`}
              >
                {t.label} ({tabCounts[t.key]})
              </button>
            ))}
          </div>

          {tab === 'suggestions' && (
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

          {tab === 'updates' && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 6 }}>Pending case updates ({updatesCount})</h3>
              <p className="hint" style={{ marginBottom: 10 }}>
                Club research and "What Claude thinks" analyses publish automatically now, so this is
                usually empty — it only catches anything that isn't auto-approved.
              </p>
              {updatesCount === 0 && <div className="empty-state">Nothing waiting on review.</div>}

              {pendingUpdates.analyses.map(a => (
                <div key={`analysis-${a.id}`} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{a.title}</div>
                      <div className="case-meta">
                        <span>{regionName(a.region_key)}</span>
                        <span className="badge badge-review">AI analysis</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => moderateAnalysis(a.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => moderateAnalysis(a.id, 'reject')}>Reject</button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{a.ai_analysis}</p>
                </div>
              ))}

              {pendingUpdates.contributions.map(c => (
                <div key={`contribution-${c.id}`} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{c.case_title}</div>
                      <div className="case-meta">
                        <span>{regionName(c.region_key)}</span>
                        <span>{c.is_club ? 'Club research' : `From ${c.username}`}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => moderateContribution(c.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => moderateContribution(c.id, 'reject')}>Reject</button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>{c.body}</p>
                  {c.link_url && <a href={c.link_url} target="_blank" rel="noopener noreferrer">🔗 Source link</a>}
                </div>
              ))}
            </div>
          )}

          {tab === 'solve' && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 10 }}>Solve requests pending review ({solveRequests.length})</h3>
              {solveRequests.length === 0 && <div className="empty-state">Nothing waiting on review.</div>}
              {solveRequests.map(sr => (
                <div key={sr.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{sr.case_title}</div>
                      <div className="case-meta">
                        <span>{sr.region_name}</span>
                        <span>Proposed by {sr.requested_by_username}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => reviewSolveRequest(sr.id, 'approve')}>Approve</button>
                      <button className="btn btn-sm btn-danger" onClick={() => reviewSolveRequest(sr.id, 'reject')}>Reject</button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>{sr.note}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {user?.is_superadmin && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 6 }}>Import cases from Wikipedia</h3>
          <p className="hint" style={{ marginBottom: 10 }}>
            Pulls the most recent 50 cases from Wikipedia's "List of unsolved murders" that map to one
            of the site's regions (skips ones that don't, e.g. Latin America — no matching region yet).
            Each lands as a pending case suggestion with a sourced link, same as any other submission.
            Running it again only adds cases it hasn't imported before.
          </p>
          {importError && <div className="error-banner">{importError}</div>}
          <button className="btn btn-sm btn-primary" onClick={importFromWikipedia} disabled={importBusy}>
            {importBusy ? 'Importing… this can take a minute' : 'Import from Wikipedia'}
          </button>
          {importResult && (
            <p className="hint" style={{ marginTop: 10 }}>
              Imported {importResult.imported.length}, skipped {importResult.skippedNoRegion} with no matching
              region, {importResult.duplicates} already imported. Scanned {importResult.scanned} candidates.
              New ones are in the pending queue above.
            </p>
          )}
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
