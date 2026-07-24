import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form.username, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, padding: '60px 20px' }}>
      <h1 style={{ marginBottom: 6 }}>Join the club</h1>
      <p className="hint" style={{ marginBottom: 20 }}>Every unsolved case needs more eyes on it.</p>
      <form onSubmit={handleSubmit} className="card">
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Username</label>
          <input value={form.username} onChange={update('username')} autoFocus required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={form.password} onChange={update('password')} minLength={8} required />
          <span className="hint">At least 8 characters.</span>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="hint" style={{ marginTop: 14 }}>
        Already a member? <Link to="/login" style={{ color: 'var(--gold)' }}>Log in</Link>
      </p>
    </div>
  );
}
