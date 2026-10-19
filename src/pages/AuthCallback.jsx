import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthCallback() {
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();
  const { ssoLogin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const savedState = sessionStorage.getItem('sso_state');

    if (!code) {
      setError('No authorization code received');
      return;
    }
    // A missing saved state must fail too: null === null would let a link carrying someone
    // else's code (and no state) sign this browser in as them.
    if (!savedState || state !== savedState) {
      setError('Invalid state parameter');
      return;
    }
    sessionStorage.removeItem('sso_state');

    ssoLogin(code)
      .then(() => navigate('/'))
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="page" style={{ maxWidth: 420 }}>
        <div className="alert alert--error">{error}</div>
        <a href="/login" className="btn btn--secondary">Back to login</a>
      </div>
    );
  }

  return <div className="loading">Completing sign in...</div>;
}
