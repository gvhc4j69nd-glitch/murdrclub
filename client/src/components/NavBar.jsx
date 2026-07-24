import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand">MURD'R<span> CLUB</span></Link>
        <nav className="nav-links">
          <NavLink to="/regions" className={({ isActive }) => (isActive ? 'active' : '')}>Regions</NavLink>
          <NavLink to="/members" className={({ isActive }) => (isActive ? 'active' : '')}>Members</NavLink>
          {user && <NavLink to="/submit" className={({ isActive }) => (isActive ? 'active' : '')}>Suggest a Case</NavLink>}
          {user && <NavLink to="/messages" className={({ isActive }) => (isActive ? 'active' : '')}>Messages</NavLink>}
          {user && <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>Admin</NavLink>}
        </nav>
        <div className="nav-right">
          {user ? (
            <>
              <Link to={`/members/${user.username}`} className="btn btn-ghost btn-sm">{user.username}</Link>
              <button className="btn btn-sm" onClick={() => { logout(); navigate('/'); }}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Join</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
