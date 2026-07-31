import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { regionName } from '../lib/regions';

export default function AllCasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const q = searchParams.get('q') || '';
  const [queryInput, setQueryInput] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setQueryInput(q); }, [q]);

  useEffect(() => {
    setData(null);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set('q', q);
    api.get(`/cases?${params.toString()}`).then(setData).catch(err => setError(err.message));
  }, [page, q]);

  // Debounce typing so search runs live without needing a submit button —
  // Enter also works immediately via the form's onSubmit.
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => {
      setSearchParams(trimmed ? { q: trimmed } : {});
    }, 400);
    return () => clearTimeout(timer);
  }, [queryInput]);

  function submitSearch(e) {
    e.preventDefault();
    const trimmed = queryInput.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
  }

  function goToPage(p) {
    const params = {};
    if (q) params.q = q;
    if (p !== 1) params.page = String(p);
    setSearchParams(params);
    window.scrollTo({ top: 0 });
  }

  if (error) return <div className="container" style={{ padding: 40 }}><div className="error-banner">{error}</div></div>;

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div className="page-title">
        <div>
          <h1>Active cases</h1>
          {data && (
            <p className="hint">
              {q
                ? `${data.total} result${data.total === 1 ? '' : 's'} for "${q}"`
                : `${data.total} unsolved murder${data.total === 1 ? '' : 's'} across every region.`}
            </p>
          )}
        </div>
        <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            className="search-input"
            placeholder="Search cases…"
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button className="btn btn-sm" type="submit">Search</button>
        </form>
      </div>

      {!data ? (
        <div className="loading">Loading…</div>
      ) : data.cases.length === 0 ? (
        <div className="empty-state">{q ? `No cases match "${q}".` : 'No active cases yet.'}</div>
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

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
          <span className="hint" style={{ alignSelf: 'center' }}>Page {page} of {data.totalPages}</span>
          <button className="btn btn-sm" disabled={page >= data.totalPages} onClick={() => goToPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
