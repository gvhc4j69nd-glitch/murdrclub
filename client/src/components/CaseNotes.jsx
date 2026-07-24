import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function CaseNotes({ caseId, initialNote }) {
  const [text, setText] = useState(initialNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    setText(initialNote || '');
    setSavedAt(null);
  }, [caseId, initialNote]);

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/cases/${caseId}/notes`, { body: text });
      setSavedAt(new Date());
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
      <div className="field" style={{ marginBottom: 8 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Theories, leads, questions to follow up on…"
          rows={6}
        />
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save notes'}
        </button>
        {savedAt && <span className="hint">Saved {savedAt.toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}
