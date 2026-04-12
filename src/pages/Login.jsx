import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getSsoLoginUrl } from '../services/authService';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const ssoUrl = getSsoLoginUrl();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Sign In</h1>

      {error && <div className="alert alert--error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn--primary btn--full">Sign In</button>
      </form>

      {ssoUrl && (
        <>
          <div className="divider">or</div>
          <a href={ssoUrl} className="btn btn--sso">Sign in with bennettdishman.com</a>
        </>
      )}

      <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#8888a0', fontSize: '0.9rem' }}>
        Don't have an account? <Link to="/register">Create one</Link>
      </p>
    </div>
  );
}
