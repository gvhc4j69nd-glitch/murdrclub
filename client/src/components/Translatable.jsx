import { useMemo, useState } from 'react';
import { franc } from 'franc-min';
import { api } from '../lib/api';

export default function Translatable({ text, className }) {
  const [translated, setTranslated] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // franc returns 'und' (undetermined) on short/ambiguous text — only hide
  // the button when it's confidently English, never on a guess.
  const isEnglish = useMemo(() => franc(text || '') === 'eng', [text]);

  if (!text?.trim()) return null;

  async function handleTranslate() {
    setBusy(true);
    setError('');
    try {
      const { translated } = await api.post('/translate', { text });
      setTranslated(translated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={className}>{translated && !showOriginal ? translated : text}</div>
      {!isEnglish && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 8 }}>
          {translated ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowOriginal(s => !s)}>
              {showOriginal ? 'Show translation' : 'Show original'}
            </button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleTranslate} disabled={busy}>
              {busy ? 'Translating…' : 'Translate to English'}
            </button>
          )}
          {error && <span className="hint" style={{ color: 'var(--accent-bright)' }}>{error}</span>}
        </div>
      )}
    </>
  );
}
