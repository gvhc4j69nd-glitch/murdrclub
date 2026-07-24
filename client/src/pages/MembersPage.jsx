import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function MembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/members').then(({ members }) => setMembers(members)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1>Member rankings</h1>
      <p className="hint" style={{ marginBottom: 20 }}>
        Ranked by how the club rates your contributions — average score, weighted by volume.
      </p>
      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="leaderboard">
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Avg rating</th>
                <th>Contributions</th>
                <th>Cases joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id}>
                  <td className="rank-cell">{i + 1}</td>
                  <td><Link to={`/members/${m.username}`} style={{ fontWeight: 700 }}>{m.username}</Link></td>
                  <td>{m.avg_rating || '—'}</td>
                  <td>{m.contribution_count}</td>
                  <td>{m.cases_joined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
