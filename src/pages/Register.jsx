import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '', first_name: '', last_name: '' });
  const [error, setError] = useState('');
  const { register } = useAuth();
  const navigate = useNavigate();

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Create Account</h1>

      {error && <div className="alert alert--error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Username</label>
          <input value={form.username} onChange={update('username')} required />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} required />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>First Name</label>
            <input value={form.first_name} onChange={update('first_name')} />
          </div>
          <div className="form-group">
            <label>Last Name</label>
            <input value={form.last_name} onChange={update('last_name')} />
          </div>
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={form.password} onChange={update('password')} required minLength={6} />
        </div>
        <button type="submit" className="btn btn--primary btn--full">Create Account</button>
      </form>

      <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#8888a0', fontSize: '0.9rem' }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
