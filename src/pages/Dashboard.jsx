import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getGroups, joinGroup } from '../services/api';

export default function Dashboard() {
  const [groups, setGroups] = useState([]);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getGroups().then((data) => setGroups(data.groups)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await joinGroup(joinCode.trim());
      setJoinCode('');
      navigate(`/groups/${data.group.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container">
      <div className="hero-section">
        <h1 className="page-title">Secret Vaults</h1>
        <p>A mutual secret exchange platform. Join a group and share your truth with security and plausible deniability.</p>
        
        <form onSubmit={handleJoin} style={{ width: '100%', maxWidth: '500px', display: 'flex', gap: '0.5rem' }}>
          <input
            placeholder="ENTER JOIN CODE..."
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            style={{
              flex: 1, padding: '1rem', background: '#0a0a0f', border: '1px solid #2a2a40',
              borderRadius: 8, color: '#a29bfe', fontFamily: "'JetBrains Mono', monospace", letterSpacing: 2,
              textAlign: 'center', fontWeight: 'bold'
            }}
          />
          <button type="submit" className="btn btn--primary" style={{ padding: '0 2rem' }} disabled={!joinCode.trim()}>JOIN</button>
        </form>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div className="section-label">Your Active Vaults</div>
        <Link to="/groups/create" className="btn btn--secondary" style={{ padding: '4px 15px', fontSize: '0.8rem' }}>+ NEW GROUP</Link>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state glass-card">
          <div className="empty-state__icon">&#128274;</div>
          <div className="empty-state__text">No groups yet. Create one or join with a code.</div>
        </div>
      ) : (
        <div className="dashboard-grid">
          {groups.map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} style={{ textDecoration: 'none' }}>
              <div className="glass-card card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div className="card__title" style={{ fontSize: '1.25rem', color: '#fff' }}>{g.name}</div>
                  <span className="badge badge--count">{g.member_count}</span>
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  {g.my_secrets > 0 ? (
                    <span className="badge badge--sealed">{g.my_secrets} Contributed</span>
                  ) : (
                    <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#8888a0' }}>Empty</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
