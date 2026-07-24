import { useState } from 'react';

export default function SolveRequestForm({ onSubmit }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(note);
      setOpen(false);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 16 }} onClick={() => setOpen(true)}>
        Propose this case is solved
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label>Why do you believe this case is solved?</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Explain the evidence that closes this case…" />
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        A regional or super admin reviews this before the case is closed.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
