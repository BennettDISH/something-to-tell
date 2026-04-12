import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import CreateGroup from './pages/CreateGroup';
import GroupView from './pages/GroupView';
import Settings from './pages/Settings';

function Nav() {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const isActive = (path) => location.pathname === path ? 'nav__link nav__link--active' : 'nav__link';

  return (
    <nav className="nav">
      <Link to="/" className="nav__logo">something to tell</Link>
      <div className="nav__links">
        <Link to="/" className={isActive('/')}>Groups</Link>
        <Link to="/settings" className={isActive('/settings')}>Settings</Link>
        <button onClick={logout} className="btn btn--secondary" style={{ padding: '4px 12px', fontSize: '0.85rem' }}>
          Sign Out
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/groups/create" element={<ProtectedRoute><CreateGroup /></ProtectedRoute>} />
        <Route path="/groups/:id" element={<ProtectedRoute><GroupView /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      </Routes>
    </div>
  );
}
