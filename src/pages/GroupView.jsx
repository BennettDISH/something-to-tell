import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getGroup, getGroupSecrets, submitSecret, deleteSecret } from '../services/api';

export default function GroupView() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [secrets, setSecrets] = useState([]);
  const [matches, setMatches] = useState([]);
  const [otherMembers, setOtherMembers] = useState([]);
  const [newSecret, setNewSecret] = useState('');
  const [obfLevel, setObfLevel] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [groupData, secretsData] = await Promise.all([getGroup(id), getGroupSecrets(id)]);
      setGroup(groupData.group);
      setSecrets(secretsData.secrets);
      setMatches(secretsData.matches);
      setOtherMembers(secretsData.otherMembers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newSecret.trim()) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const data = await submitSecret(id, newSecret.trim(), obfLevel);
      setNewSecret('');
      if (data.matches?.length > 0) {
        setSuccess(`Vault opened! ${data.matches.length} match${data.matches.length > 1 ? 'es' : ''} found.`);
      } else {
        setSuccess('Secret sealed. It will be revealed if someone submits a matching secret.');
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (secretId) => {
    try {
      await deleteSecret(secretId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(group.join_code);
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="page"><div className="alert alert--error">Group not found</div></div>;

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{group.name}</h1>
        <span className="badge badge--count">{group.members?.length} members</span>
      </div>
      {group.description && <p style={{ color: '#8888a0', marginBottom: '1rem' }}>{group.description}</p>}

      <div style={{ marginBottom: '2rem' }}>
        <span style={{ color: '#555570', fontSize: '0.8rem' }}>Join code: </span>
        <span className="join-code" onClick={copyCode} title="Click to copy">{group.join_code}</span>
      </div>

      {/* Members */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {group.members?.map((m) => (
          <span key={m.central_user_id} style={{
            padding: '4px 10px', background: '#1a1a2e', borderRadius: 20, fontSize: '0.8rem',
            border: '1px solid #2a2a40', color: m.central_user_id === user.central_user_id ? '#a29bfe' : '#8888a0'
          }}>
            {m.username}{m.role === 'admin' && ' *'}
          </span>
        ))}
      </div>

      {/* Submit secret */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Submit a Secret</h3>
        {error && <div className="alert alert--error">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Your secret</label>
            <textarea
              value={newSecret}
              onChange={(e) => setNewSecret(e.target.value)}
              placeholder="Something you want to tell someone..."
              required
            />
          </div>
          <div className="form-group">
            <label>Obfuscation level ({obfLevel === 0 ? 'off' : `${obfLevel} decoys`})</label>
            <div className="obfuscation-control">
              <span>0</span>
              <input type="range" min="0" max="10" value={obfLevel} onChange={(e) => setObfLevel(+e.target.value)} />
              <span>{obfLevel}</span>
            </div>
            <div className="form-hint">
              {obfLevel === 0
                ? 'Your secret will be shown directly when the vault opens.'
                : `Your secret will be mixed with ${obfLevel} AI-generated decoy${obfLevel > 1 ? 's' : ''}.`}
            </div>
          </div>
          <button type="submit" className="btn btn--primary" disabled={submitting || !newSecret.trim()}>
            {submitting ? 'Comparing with AI...' : 'Seal Secret'}
          </button>
        </form>
      </div>

      {/* Other members' activity */}
      {otherMembers.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#8888a0' }}>Sealed Secrets</h3>
          {otherMembers.map((m) => (
            <div key={m.username} style={{ padding: '0.5rem 0', color: '#555570', fontSize: '0.9rem' }}>
              {m.username} has {m.secret_count} sealed secret{m.secret_count !== 1 && 's'}
            </div>
          ))}
        </div>
      )}

      {/* Vault Matches */}
      {matches.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#00b894' }}>Opened Vaults</h3>
          {matches.map((m) => {
            const isA = m.user_a_id === user.central_user_id;
            const myName = isA ? m.user_a_name : m.user_b_name;
            const theirName = isA ? m.user_b_name : m.user_a_name;
            const myItems = isA ? m.obfuscated_a : m.obfuscated_b;
            const theirItems = isA ? m.obfuscated_b : m.obfuscated_a;

            return (
              <div key={m.id} className="vault-match">
                <div className="vault-match__header">&#128275; Vault opened between {myName} & {theirName}</div>
                <div className="vault-match__secrets">
                  <div className="vault-match__side">
                    <div className="vault-match__label">Your secret{myItems.length > 1 ? ' (one of these is real)' : ''}</div>
                    <ul className="vault-match__items">
                      {myItems.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                  <div className="vault-match__side">
                    <div className="vault-match__label">{theirName}'s secret{theirItems.length > 1 ? ' (one of these is real)' : ''}</div>
                    <ul className="vault-match__items">
                      {theirItems.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                </div>
                {m.ai_reasoning && <div className="vault-match__reasoning">"{m.ai_reasoning}"</div>}
              </div>
            );
          })}
        </>
      )}

      {/* My sealed secrets */}
      {secrets.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', marginTop: '2rem' }}>Your Secrets</h3>
          {secrets.map((s) => (
            <div key={s.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem' }}>{s.content}</span>
                <div style={{ marginTop: '0.25rem' }}>
                  <span className={`badge badge--${s.status}`}>{s.status}</span>
                  {s.obfuscation_level > 0 && (
                    <span className="badge badge--count" style={{ marginLeft: '0.5rem' }}>
                      {s.obfuscation_level} decoys
                    </span>
                  )}
                </div>
              </div>
              {s.status === 'sealed' && (
                <button className="btn btn--danger" onClick={() => handleDelete(s.id)} style={{ flexShrink: 0 }}>Delete</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
