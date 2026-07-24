import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext.jsx';

export default function HomePage() {
  const { user } = useAuth();
  const [regions, setRegions] = useState([]);

  useEffect(() => {
    api.get('/regions').then(({ regions }) => setRegions(regions)).catch(() => {});
  }, []);

  const totalCases = regions.reduce((sum, r) => sum + r.case_count, 0);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">Real People. Real Cases. Real Impact.</div>
        <h1>The hunt for answers doesn't end when the case goes cold.</h1>
        <p>
          MURD'R CLUB organizes the world's top unsolved murders by region. Join a case, dig up
          evidence, vote on what other members contribute, and climb the ranks as a trusted
          investigator.
        </p>
        <div className="hero-actions">
          <Link to="/regions" className="btn btn-primary">Browse regions</Link>
          {!user && <Link to="/register" className="btn">Join the club</Link>}
        </div>
      </section>

      <section className="section container">
        <div className="stat-row">
          <div className="stat-tile">
            <div className="num">{regions.length || 20}</div>
            <div className="label">Regions covered</div>
          </div>
          <div className="stat-tile">
            <div className="num">{totalCases}</div>
            <div className="label">Active cases</div>
          </div>
          <div className="stat-tile">
            <div className="num">1–5</div>
            <div className="label">Member-rated evidence</div>
          </div>
        </div>
      </section>

      <section className="section container">
        <h2>How it works</h2>
        <p className="section-sub">Connect. Investigate. Make a difference.</p>
        <div className="region-grid">
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Connect</h3>
            <p className="hint">Join the club, pick a region — from the Midwest US to the Baltic States — and find your fellow hunters.</p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Investigate</h3>
            <p className="hint">Join the hunt on a specific case to unlock its evidence feed and group chat, and dig in.</p>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Make a Difference</h3>
            <p className="hint">Add write-ups, links, photos, and video. Fellow hunters rate your contributions 1–5, and strong track records climb the member leaderboard.</p>
          </div>
        </div>
      </section>

      <section className="section container">
        <h2>Regions</h2>
        <p className="section-sub">Pick a region to see its top unsolved murders.</p>
        <div className="region-grid">
          {regions.slice(0, 8).map(r => (
            <Link key={r.key} to={`/regions/${r.key}`} className="region-card">
              <div className="region-name">{r.name}</div>
              <div className="region-count">{r.case_count} active case{r.case_count === 1 ? '' : 's'}</div>
            </Link>
          ))}
        </div>
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <Link to="/regions" className="btn">See all regions</Link>
        </div>
      </section>
    </>
  );
}
