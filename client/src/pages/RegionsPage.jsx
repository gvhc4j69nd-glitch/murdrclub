import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function RegionsPage() {
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/regions').then(({ regions }) => setRegions(regions)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div className="page-title">
        <div>
          <h1>Regions</h1>
          <p className="hint">Every case belongs to one of these 20 regions.</p>
        </div>
      </div>
      {loading ? (
        <div className="loading">Loading regions…</div>
      ) : (
        <div className="region-grid">
          {regions.map(r => (
            <Link key={r.key} to={`/regions/${r.key}`} className="region-card">
              <div className="region-name">{r.name}</div>
              <div className="region-count">{r.case_count} active case{r.case_count === 1 ? '' : 's'}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
