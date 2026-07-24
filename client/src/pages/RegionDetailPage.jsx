import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function RegionDetailPage() {
  const { key } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/regions/${key}`)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [key]);

  if (loading) return <div className="loading">Loading…</div>;
  if (error) return <div className="container" style={{ padding: 40 }}><div className="error-banner">{error}</div></div>;

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div className="page-title">
        <div>
          <h1>{data.region.name}</h1>
          <p className="hint">Top unsolved murders, ranked by hunters on the case.</p>
        </div>
        <Link to="/submit" state={{ region_key: key }} className="btn btn-primary">Suggest a case here</Link>
      </div>

      {data.cases.length === 0 ? (
        <div className="empty-state">No active cases in this region yet. Be the first to suggest one.</div>
      ) : (
        data.cases.map((c, i) => (
          <Link key={c.id} to={`/cases/${c.id}`} className="case-row" style={{ marginBottom: 10 }}>
            <span className="case-rank">#{i + 1}</span>
            <div style={{ flex: 1 }}>
              <div className="case-title">{c.title}{c.victim_name ? ` — ${c.victim_name}` : ''}</div>
              <div className="case-meta">
                {c.location && <span>{c.location}</span>}
                {c.date_occurred && <span>{c.date_occurred}</span>}
                <span>{c.member_count} on the hunt</span>
                <span>{c.contribution_count} contribution{c.contribution_count === 1 ? '' : 's'}</span>
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
