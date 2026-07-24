import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function CaseNotes({ caseId, notes: initialNotes }) {
  const [notes, setNotes] = useState(initialNotes || []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNotes(initialNotes || []);
  }, [caseId, initialNotes]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { note } = await api.post(`/cases/${caseId}/notes`, { body: text });
      setNotes(n => [note, ...n]);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>My notes</h3>
      <p className="hint" style={{ marginBottom: 8 }}>Private to you — no one else on this case can see these.</p>

      <form onSubmit={handleAdd}>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Theories, leads, questions to follow up on…"
            rows={4}
          />
        </div>
        <button type="submit" className="btn btn-sm btn-primary" style={{ marginBottom: 12 }} disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </form>

      {notes.length === 0 ? (
        <div className="empty-state">No notes yet.</div>
      ) : (
        notes.map(n => (
          <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div className="hint" style={{ marginBottom: 4 }}>{new Date(n.created_at).toLocaleString()}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
          </div>
        ))
      )}
    </div>
  );
}
