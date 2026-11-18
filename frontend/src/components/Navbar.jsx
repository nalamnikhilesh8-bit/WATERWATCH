import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const role = user?.role
  const handleSignOut = () => { signOut(); navigate('/') }
  return <header className="topbar"><div className="topbar-inner">
    <Link to="/" className="brand"><span className="brand-mark">≈</span><span>waterwatch</span><span className="brand-dot" /></Link>
    <nav className="main-nav" aria-label="Main navigation">
      <NavLink to="/" end>Community</NavLink>
      {user?.role === 'RESIDENT' && <><NavLink to="/report">Report a leak</NavLink><NavLink to="/my-reports">My reports</NavLink></>}
      {role === 'MAINTENANCE' && <NavLink to="/maintenance">My work queue</NavLink>}
      {role === 'ADMIN' && <NavLink to="/admin">Operations</NavLink>}
    </nav>
    <div className="nav-actions">{user ? <><span className="role-chip"><span className="avatar">{(user.first_name || user.email || 'W').slice(0, 1).toUpperCase()}</span><span>{user.first_name || user.email.split('@')[0]}<small>{role?.toLowerCase()}</small></span></span><button className="button button-quiet button-small" onClick={handleSignOut}>Sign out</button></> : <><Link to="/login" className="button button-quiet button-small">Sign in</Link><Link to="/register" className="button button-dark button-small">Join community <span>↗</span></Link></>}</div>
  </div></header>
}
