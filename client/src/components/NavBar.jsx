import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  function closeMenu() {
    setMenuOpen(false);
  }

  function submitSearch(e) {
    e.preventDefault();
    const trimmed = search.trim();
    closeMenu();
    navigate(trimmed ? `/cases?q=${encodeURIComponent(trimmed)}` : '/cases');
  }

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={closeMenu}>MURD'R<span> CLUB</span></Link>
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`nav-collapse${menuOpen ? ' open' : ''}`}>
          <nav className="nav-links">
            <NavLink to="/regions" onClick={closeMenu} className={({ isActive }) => (isActive ? 'active' : '')}>Regions</NavLink>
            <NavLink to="/members" onClick={closeMenu} className={({ isActive }) => (isActive ? 'active' : '')}>Members</NavLink>
            {user && <NavLink to="/submit" onClick={closeMenu} className={({ isActive }) => (isActive ? 'active' : '')}>Suggest a Case</NavLink>}
            {user && <NavLink to="/messages" onClick={closeMenu} className={({ isActive }) => (isActive ? 'active' : '')}>Messages</NavLink>}
            {user && <NavLink to="/admin" onClick={closeMenu} className={({ isActive }) => (isActive ? 'active' : '')}>Admin</NavLink>}
          </nav>
          <form className="nav-search" onSubmit={submitSearch}>
            <input
              type="search"
              className="search-input"
              placeholder="Search cases…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </form>
          <div className="nav-right">
            {user ? (
              <>
                <Link to={`/members/${user.username}`} className="btn btn-ghost btn-sm" onClick={closeMenu}>{user.username}</Link>
                <button className="btn btn-sm" onClick={() => { closeMenu(); logout(); navigate('/'); }}>Log out</button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm" onClick={closeMenu}>Log in</Link>
                <Link to="/register" className="btn btn-primary btn-sm" onClick={closeMenu}>Join</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
