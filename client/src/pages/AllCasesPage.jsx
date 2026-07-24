import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { regionName } from '../lib/regions';

export default function AllCasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api.get(`/cases?page=${page}`).then(setData).catch(err => setError(err.message));
  }, [page]);

  function goToPage(p) {
    setSearchParams(p === 1 ? {} : { page: String(p) });
    window.scrollTo({ top: 0 });
  }

  if (error) return <div className="container" style={{ padding: 40 }}><div className="error-banner">{error}</div></div>;
  if (!data) return <div className="loading">Loading…</div>;

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div className="page-title">
        <div>
          <h1>Active cases</h1>
          <p className="hint">{data.total} unsolved murder{data.total === 1 ? '' : 's'} across every region.</p>
        </div>
      </div>

      {data.cases.length === 0 ? (
        <div className="empty-state">No active cases yet.</div>
      ) : (
        data.cases.map((c, i) => (
          <Link key={c.id} to={`/cases/${c.id}`} className="case-row" style={{ marginBottom: 10 }}>
            <span className="case-rank">#{(page - 1) * data.pageSize + i + 1}</span>
            <div style={{ flex: 1 }}>
              <div className="case-title">{c.title}{c.victim_name ? ` — ${c.victim_name}` : ''}</div>
              <div className="case-meta">
                <span>{regionName(c.region_key)}</span>
                {c.location && <span>{c.location}</span>}
                {c.date_occurred && <span>{c.date_occurred}</span>}
                <span>{c.member_count} on the hunt</span>
                <span>{c.contribution_count} contribution{c.contribution_count === 1 ? '' : 's'}</span>
              </div>
            </div>
          </Link>
        ))
      )}

      {data.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
          <span className="hint" style={{ alignSelf: 'center' }}>Page {page} of {data.totalPages}</span>
          <button className="btn btn-sm" disabled={page >= data.totalPages} onClick={() => goToPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
