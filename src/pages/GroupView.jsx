import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getGroup, updateGroup, getGroupSecrets, addSecret, submitSecret, unsubmitSecret, triggerCompare, deleteSecret } from '../services/api';

export default function GroupView() {
  const { id } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [secrets, setSecrets] = useState([]);
  const [matches, setMatches] = useState([]);
  const [otherMembers, setOtherMembers] = useState([]);
  const [submittedStats, setSubmittedStats] = useState(null);
  const [comparisons, setComparisons] = useState([]);
  const [newSecret, setNewSecret] = useState('');
  const [obfLevel, setObfLevel] = useState(3);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  const isGroupAdmin = group?.members?.find(
    (m) => m.central_user_id === user.central_user_id && m.role === 'admin'
  );

  const load = async () => {
    try {
      const [groupData, secretsData] = await Promise.all([getGroup(id), getGroupSecrets(id)]);
      setGroup(groupData.group);
      setSecrets(secretsData.secrets);
      setMatches(secretsData.matches);
      setOtherMembers(secretsData.otherMembers);
      setSubmittedStats(secretsData.submittedStats);
      setComparisons(secretsData.comparisons || []);
      setAiPrompt(groupData.group.ai_prompt || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newSecret.trim()) return;
    setError('');
    setSuccess('');
    try {
      await addSecret(id, newSecret.trim(), obfLevel);
      setNewSecret('');
      setSuccess('Secret sealed. Submit it when you\'re ready for comparison.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmit = async (secretId) => {
    setError(''); setSuccess('');
    try {
      await submitSecret(secretId);
      setSuccess('Secret submitted for comparison.');
      await load();
    } catch (err) { setError(err.message); }
  };

  const handleUnsubmit = async (secretId) => {
    setError(''); setSuccess('');
    try {
      await unsubmitSecret(secretId);
      await load();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (secretId) => {
    setError(''); setSuccess('');
    try {
      await deleteSecret(secretId);
      await load();
    } catch (err) { setError(err.message); }
  };

  const handleCompare = async () => {
    setComparing(true);
    setError(''); setSuccess('');
    try {
      const data = await triggerCompare(id);
      if (data.matches.length > 0) {
        setSuccess(`Vault opened! ${data.matches.length} match${data.matches.length > 1 ? 'es' : ''} found across ${data.compared} secrets.`);
      } else {
        setSuccess(`Compared ${data.compared} secrets — no matches found.`);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };

  const handleSavePrompt = async () => {
    setError('');
    try {
      await updateGroup(id, { ai_prompt: aiPrompt });
      setEditingPrompt(false);
      setSuccess('AI instructions updated.');
      await load();
    } catch (err) { setError(err.message); }
  };

  const copyCode = () => navigator.clipboard.writeText(group.join_code);

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="page"><div className="alert alert--error">Group not found</div></div>;

  return (
    <div className="container">
      <div className="layout-grid">
        {/* SIDEBAR: Group Context & Controls */}
        <div className="sidebar-panel">
          <div className="glass-card">
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', letterSpacing: '-0.5px' }}>{group.name}</h1>
            {group.description && <p style={{ color: '#8888a0', fontSize: '0.9rem', marginBottom: '1rem' }}>{group.description}</p>}
            
            <div className="section-label">Access Code</div>
            <div className="join-code" onClick={copyCode} title="Click to copy" style={{ display: 'block', textAlign: 'center', marginBottom: '1rem' }}>
              {group.join_code}
            </div>

            <div className="section-label">Operatives</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              {group.members?.map((m) => (
                <div key={m.central_user_id} className="badge badge--count" style={{
                  border: m.central_user_id === user.central_user_id ? '1px solid #a29bfe' : '1px solid transparent'
                }}>
                  {m.username}{m.role === 'admin' && ' *'}
                </div>
              ))}
            </div>

            {/* Admin Section in Sidebar */}
            {isGroupAdmin && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                <div className="section-label">Intelligence (Admin)</div>
                
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ color: '#8888a0', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                    {submittedStats?.submitted_count || 0} secrets ready.
                  </p>
                  <button
                    className="btn btn--primary btn--full"
                    style={{ padding: '8px', fontSize: '0.8rem' }}
                    disabled={comparing || !submittedStats || submittedStats.submitted_count < 2}
                    onClick={handleCompare}
                  >
                    {comparing ? 'ANALYZING...' : 'TRIGGER COMPARISON'}
                  </button>
                </div>

                {!editingPrompt ? (
                  <button className="btn btn--secondary btn--full" style={{ padding: '6px', fontSize: '0.75rem' }} onClick={() => setEditingPrompt(true)}>
                    {group.ai_prompt ? 'EDIT AI RULES' : 'CONFIGURE AI'}
                  </button>
                ) : (
                  <div className="glass-card" style={{ padding: '0.75rem', marginTop: '0.5rem', background: '#0a0a0f' }}>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="AI logic..."
                      rows={4}
                      style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn--primary" style={{ flex: 1, padding: '4px', fontSize: '0.7rem' }} onClick={handleSavePrompt}>SAVE</button>
                      <button className="btn btn--secondary" style={{ flex: 1, padding: '4px', fontSize: '0.7rem' }} onClick={() => setEditingPrompt(false)}>X</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {otherMembers.length > 0 && (
            <div className="glass-card" style={{ background: 'transparent' }}>
              <div className="section-label">Submission Status</div>
              {otherMembers.map((m) => (
                <div key={m.username} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#8888a0', marginBottom: '0.4rem' }}>
                  <span>{m.username}</span>
                  <span style={{ color: m.submitted_count > 0 ? '#00b894' : '#555570' }}>
                    {m.submitted_count}/{m.total_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MAIN AREA: Activity & Secrets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {error && <div className="alert alert--error">{error}</div>}
          {success && <div className="alert alert--success">{success}</div>}

          {/* THE VAULT: Results */}
          {(matches.length > 0 || comparisons.length > 0) && (
            <section>
              <div className="section-label">The Vault (Results)</div>
              {matches.length > 0 ? (
                matches.map((m) => {
                  const isA = m.user_a_id === user.central_user_id;
                  const myName = isA ? m.user_a_name : m.user_b_name;
                  const theirName = isA ? m.user_b_name : m.user_a_name;
                  const myItems = isA ? m.obfuscated_a : m.obfuscated_b;
                  const theirItems = isA ? m.obfuscated_b : m.obfuscated_a;

                  return (
                    <div key={m.id} className="vault-match glass-card" style={{ border: '1px solid rgba(0, 184, 148, 0.4)' }}>
                      <div className="vault-match__header" style={{ color: '#00b894', fontSize: '1.1rem' }}>
                        &#128275; Vault Opened: {myName} & {theirName}
                      </div>
                      <div className="vault-match__secrets" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="vault-match__side">
                          <div className="vault-match__label">Your Secret Contribution</div>
                          <ul className="vault-match__items">
                            {myItems.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                        <div className="vault-match__side">
                          <div className="vault-match__label">{theirName}'s Contribution</div>
                          <ul className="vault-match__items">
                            {theirItems.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      </div>
                      {m.ai_reasoning && <div className="vault-match__reasoning" style={{ marginTop: '1rem' }}>AI Logic: "{m.ai_reasoning}"</div>}
                    </div>
                  );
                })
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {comparisons.map((c) => (
                    <div key={c.id} className="glass-card" style={{ 
                      padding: '0.75rem 1rem', 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderLeft: c.matched ? '4px solid #00b894' : '4px solid #2a2a40'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span className={`badge badge--${c.matched ? 'matched' : 'sealed'}`}>
                          {c.matched ? 'MATCHED' : 'NO MATCH'}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#8888a0' }}>{c.user_summary}</span>
                      </div>
                      <span style={{ color: '#555570', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        CONFIDENCE: {Math.round(c.confidence * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ADD SECRET */}
          <section className="glass-card" style={{ background: 'rgba(162, 155, 254, 0.03)', border: '1px solid rgba(162, 155, 254, 0.2)' }}>
            <div className="section-label">New Contribution</div>
            <form onSubmit={handleAdd}>
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <textarea
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="Type your secret here... It will be sealed and only revealed upon a semantic match."
                  required
                  style={{ background: 'rgba(10, 10, 15, 0.8)', fontSize: '1.1rem', minHeight: '120px' }}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: '2rem', alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Plausible Deniability ({obfLevel} Decoys)</label>
                  <div className="obfuscation-control">
                    <input type="range" min="0" max="10" value={obfLevel} onChange={(e) => setObfLevel(+e.target.value)} />
                    <span>{obfLevel}</span>
                  </div>
                  <p className="form-hint" style={{ marginTop: '0.5rem' }}>
                    {obfLevel === 0 ? 'Pure truth.' : `Secret will be hidden among ${obfLevel} generated decoys.`}
                  </p>
                </div>
                <button type="submit" className="btn btn--primary btn--full" style={{ padding: '12px' }} disabled={!newSecret.trim()}>
                  SEAL SECRET
                </button>
              </div>
            </form>
          </section>

          {/* MY CONTRIBUTIONS */}
          {secrets.length > 0 && (
            <section>
              <div className="section-label">Your Contributions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {secrets.map((s) => (
                  <div key={s.id} className="glass-card card" style={{ 
                    marginBottom: 0, padding: '1rem',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.95rem', color: '#e8e8f0' }}>{s.content}</span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className={`badge badge--${s.status}`}>{s.status.toUpperCase()}</span>
                        {s.obfuscation_level > 0 && (
                          <span className="badge badge--count" style={{ fontSize: '0.65rem' }}>
                            {s.obfuscation_level} DECOYS
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {s.status === 'sealed' && (
                        <>
                          <button className="btn btn--primary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleSubmit(s.id)}>SUBMIT</button>
                          <button className="btn btn--danger" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleDelete(s.id)}>DELETE</button>
                        </>
                      )}
                      {s.status === 'submitted' && (
                        <button className="btn btn--secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleUnsubmit(s.id)}>UNSUBMIT</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
