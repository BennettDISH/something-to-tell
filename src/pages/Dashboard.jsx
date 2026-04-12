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
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Your Groups</h1>
        <Link to="/groups/create" className="btn btn--primary">New Group</Link>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <form onSubmit={handleJoin} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          placeholder="Enter join code..."
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          style={{
            flex: 1, padding: '0.5rem 1rem', background: '#0a0a0f', border: '1px solid #2a2a40',
            borderRadius: 6, color: '#e8e8f0', fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1
          }}
        />
        <button type="submit" className="btn btn--secondary" disabled={!joinCode.trim()}>Join</button>
      </form>

      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">&#128274;</div>
          <div className="empty-state__text">No groups yet. Create one or join with a code.</div>
        </div>
      ) : (
        groups.map((g) => (
          <Link key={g.id} to={`/groups/${g.id}`} style={{ textDecoration: 'none' }}>
            <div className="card">
              <div className="card__title">{g.name}</div>
              <div className="card__subtitle">
                {g.member_count} member{g.member_count !== 1 && 's'}
                {g.my_secrets > 0 && <> &middot; {g.my_secrets} secret{g.my_secrets !== 1 && 's'}</>}
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
