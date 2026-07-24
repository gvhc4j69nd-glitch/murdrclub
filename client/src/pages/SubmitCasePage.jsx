import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { REGIONS } from '../lib/regions';

export default function SubmitCasePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    title: '',
    victim_name: '',
    region_key: location.state?.region_key || REGIONS[0].key,
    location: '',
    date_occurred: '',
    summary: '',
  });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { case: created } = await api.post('/cases', form);
      setDone(true);
      setTimeout(() => navigate(`/regions/${created.region_key}`), 1400);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="container" style={{ padding: '60px 20px', maxWidth: 560, textAlign: 'center' }}>
        <h1>Submitted for review</h1>
        <p className="hint">A regional admin needs to approve this case before it goes live. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '50px 20px', maxWidth: 560 }}>
      <h1 style={{ marginBottom: 6 }}>Suggest an unsolved case</h1>
      <p className="hint" style={{ marginBottom: 20 }}>
        Cases go live once a regional admin approves them. You'll automatically be the first member on the hunt.
      </p>
      <form onSubmit={handleSubmit} className="card">
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Case title</label>
          <input value={form.title} onChange={update('title')} required placeholder="e.g. The Foggy Pier Killing" />
        </div>
        <div className="field">
          <label>Victim name (if known)</label>
          <input value={form.victim_name} onChange={update('victim_name')} />
        </div>
        <div className="field">
          <label>Region</label>
          <select value={form.region_key} onChange={update('region_key')}>
            {REGIONS.map(r => (
              <option key={r.key} value={r.key}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Location</label>
          <input value={form.location} onChange={update('location')} placeholder="City, state/province, country" />
        </div>
        <div className="field">
          <label>Date occurred</label>
          <input value={form.date_occurred} onChange={update('date_occurred')} placeholder="e.g. March 1998" />
        </div>
        <div className="field">
          <label>Summary</label>
          <textarea value={form.summary} onChange={update('summary')} required placeholder="What's known so far?" />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
    </div>
  );
}
