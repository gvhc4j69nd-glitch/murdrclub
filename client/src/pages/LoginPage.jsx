import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      navigate(location.state?.from?.pathname || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, padding: '60px 20px' }}>
      <h1 style={{ marginBottom: 20 }}>Log in</h1>
      <form onSubmit={handleSubmit} className="card">
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Username or email</label>
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="hint" style={{ marginTop: 14 }}>
        No account? <Link to="/register" style={{ color: 'var(--gold)' }}>Join the club</Link>
      </p>
    </div>
  );
}
