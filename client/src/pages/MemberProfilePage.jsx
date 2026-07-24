import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext.jsx';
import { regionName } from '../lib/regions';

export default function MemberProfilePage() {
  const { username } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/members/${username}`).then(({ member }) => setMember(member)).catch(err => setError(err.message));
  }, [username]);

  if (error) return <div className="container" style={{ padding: 40 }}><div className="error-banner">{error}</div></div>;
  if (!member) return <div className="loading">Loading…</div>;

  return (
    <div className="container" style={{ padding: '40px 20px', maxWidth: 720 }}>
      <div className="page-title">
        <div>
          <h1>{member.username}</h1>
          {member.rank && <p className="hint">Ranked #{member.rank} in the club</p>}
        </div>
        {user && user.username !== member.username && (
          <button className="btn btn-primary" onClick={() => navigate(`/messages/${member.id}`)}>Message</button>
        )}
      </div>

      {member.bio && <p style={{ marginBottom: 20 }}>{member.bio}</p>}

      <div className="stat-row" style={{ marginBottom: 24 }}>
        <div className="stat-tile"><div className="num">{member.avg_rating || '—'}</div><div className="label">Avg rating</div></div>
        <div className="stat-tile"><div className="num">{member.contribution_count}</div><div className="label">Contributions</div></div>
        <div className="stat-tile"><div className="num">{member.cases_joined.length}</div><div className="label">Cases joined</div></div>
      </div>

      {member.region_admin_of.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Regional admin for</h3>
          {member.region_admin_of.map(r => <span key={r.key} className="badge badge-approved" style={{ marginRight: 6 }}>{r.name}</span>)}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Cases on the hunt</h3>
        {member.cases_joined.length === 0 && <div className="empty-state">Not on any hunts yet.</div>}
        {member.cases_joined.map(c => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <Link to={`/cases/${c.id}`} style={{ fontWeight: 700 }}>{c.title}</Link>
            <div className="hint">{regionName(c.region_key)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
