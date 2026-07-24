import { useState } from 'react';

export default function ContributionForm({ onSubmit }) {
  const [form, setForm] = useState({ body: '', link_url: '', photo_url: '', video_url: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(form);
      setForm({ body: '', link_url: '', photo_url: '', video_url: '' });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 16 }} onClick={() => setOpen(true)}>
        + Add information
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label>Write-up</label>
        <textarea value={form.body} onChange={update('body')} placeholder="What did you find?" />
      </div>
      <div className="field">
        <label>Link</label>
        <input value={form.link_url} onChange={update('link_url')} placeholder="https://…" />
      </div>
      <div className="field">
        <label>Photo URL</label>
        <input value={form.photo_url} onChange={update('photo_url')} placeholder="https://…jpg" />
      </div>
      <div className="field">
        <label>Video URL</label>
        <input value={form.video_url} onChange={update('video_url')} placeholder="https://…mp4 or YouTube link" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
