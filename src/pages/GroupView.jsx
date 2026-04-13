import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getGroup, updateGroup, getGroupSecrets, addSecret, submitSecret, unsubmitSecret, triggerCompare, deleteSecret, getAdminLogs, deleteGroup } from '../services/api';

const MATCH_MODES = [
  { value: 'semantic', label: 'Semantic Equivalence', description: 'Match if secrets mean the same thing.' },
  { value: 'seriousness', label: 'Same Gravity', description: 'Match if secrets carry equal weight or seriousness.' },
  { value: 'sentiment', label: 'Shared Sentiment', description: 'Match if both are positive, negative, fearful, etc.' },
  { value: 'custom', label: 'Custom Logic', description: 'Define your own rules for the AI.' },
];

export default function GroupView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState(null);
  const [secrets, setSecrets] = useState([]);
  const [matches, setMatches] = useState([]);
  const [otherMembers, setOtherMembers] = useState([]);
  const [submittedStats, setSubmittedStats] = useState(null);
  const [comparisons, setComparisons] = useState([]);
  const [adminLogs, setAdminLogs] = useState(null);
  const [showAdminLogs, setShowAdminLogs] = useState(false);
  
  const [newSecret, setNewSecret] = useState('');
  const [obfLevel, setObfLevel] = useState(3);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  
  const [editingConfig, setEditingConfig] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [matchMode, setMatchMode] = useState('semantic');

  const isGroupAdmin = group?.members?.find(
    (m) => m.central_user_id === user.central_user_id && m.role === 'admin'
  );

  const handleDeleteGroup = async () => {
    if (!window.confirm('CRITICAL: Are you sure you want to PERMANENTLY delete this vault and all secrets within? This cannot be undone.')) return;
    try {
      await deleteGroup(id);
      navigate('/');
    } catch (err) { setError(err.message); }
  };

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
      setMatchMode(groupData.group.match_mode || 'semantic');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAdminLogs = async () => {
    try {
      const data = await getAdminLogs(id);
      setAdminLogs(data);
    } catch (err) { setError(err.message); }
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (showAdminLogs && isGroupAdmin) loadAdminLogs();
  }, [showAdminLogs]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newSecret.trim()) return;
    setError(''); setSuccess('');
    try {
      await addSecret(id, newSecret.trim(), obfLevel);
      setNewSecret('');
      setSuccess('Secret sealed. Submit it when you\'re ready.');
      await load();
    } catch (err) { setError(err.message); }
  };

  const handleSubmit = async (secretId) => {
    setError(''); setSuccess('');
    try {
      await submitSecret(secretId);
      setSuccess('Secret submitted.');
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
      let msg = `Compared ${data.compared} secrets.`;
      if (data.matches.length > 0) {
        msg += ` ${data.matches.length} match found!`;
      } else {
        msg += ` No matches found.`;
      }
      if (data.errors) {
        msg += ` (${data.errors} AI failures logged)`;
      }
      setSuccess(msg);
      await load();
      if (showAdminLogs) loadAdminLogs();
    } catch (err) {
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };

  const handleSaveConfig = async () => {
    setError('');
    try {
      await updateGroup(id, { ai_prompt: aiPrompt, match_mode: matchMode });
      setEditingConfig(false);
      setSuccess('Intelligence rules updated.');
      await load();
    } catch (err) { setError(err.message); }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(group.join_code);
    setSuccess('Join code copied to clipboard');
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!group) return <div className="page"><div className="alert alert--error">Group not found</div></div>;

  return (
    <div className="container">
      <div className="layout-grid">
        {/* SIDEBAR */}
        <div className="sidebar-panel">
          <div className="glass-card">
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{group.name}</h1>
            
            <div className="section-label">Access Code</div>
            <div className="join-code" onClick={copyCode} style={{ display: 'block', textAlign: 'center', marginBottom: '1rem' }}>
              {group.join_code}
            </div>

            {isGroupAdmin && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                <div className="section-label">Intelligence Control</div>
                
                {!editingConfig ? (
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#a29bfe', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                      MODE: {MATCH_MODES.find(m => m.value === matchMode)?.label.toUpperCase()}
                    </div>
                    <button className="btn btn--secondary btn--full" style={{ padding: '6px', fontSize: '0.75rem' }} onClick={() => setEditingConfig(true)}>
                      CONFIGURE RULES
                    </button>
                  </div>
                ) : (
                  <div className="glass-card" style={{ padding: '0.75rem', marginTop: '0.5rem', background: '#0a0a0f' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.7rem' }}>MATCHING STRATEGY</label>
                      <select value={matchMode} onChange={(e) => setMatchMode(e.target.value)} style={{ fontSize: '0.8rem', padding: '4px' }}>
                        {MATCH_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <p style={{ fontSize: '0.7rem', color: '#555570', marginTop: '4px' }}>{MATCH_MODES.find(m => m.value === matchMode)?.description}</p>
                    </div>
                    
                    {matchMode === 'custom' && (
                      <div className="form-group">
                        <label style={{ fontSize: '0.7rem' }}>REVEAL LOGIC</label>
                        <textarea
                          value={aiPrompt}
                          onChange={(e) => setAiPrompt(e.target.value)}
                          placeholder="Reveal when..."
                          rows={3}
                          style={{ fontSize: '0.8rem' }}
                        />
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn--primary" style={{ flex: 1, padding: '4px', fontSize: '0.7rem' }} onClick={handleSaveConfig}>SAVE</button>
                      <button className="btn btn--secondary" style={{ flex: 1, padding: '4px', fontSize: '0.7rem' }} onClick={() => setEditingConfig(false)}>X</button>
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: '1rem' }}>
                  <button
                    className="btn btn--primary btn--full"
                    style={{ padding: '10px', fontSize: '0.8rem', fontWeight: 'bold' }}
                    disabled={comparing || !submittedStats || submittedStats.submitted_count < 2}
                    onClick={handleCompare}
                  >
                    {comparing ? 'ANALYZING...' : 'RUN COMPARISON'}
                  </button>
                </div>

                {user.is_admin && (
                  <button 
                    className="btn btn--secondary btn--full" 
                    style={{ padding: '6px', fontSize: '0.75rem', borderStyle: 'dashed', marginTop: '0.5rem' }}
                    onClick={() => setShowAdminLogs(!showAdminLogs)}
                  >
                    {showAdminLogs ? 'HIDE DEEP INTEL' : 'VIEW DEEP INTEL'}
                  </button>
                )}

                <div style={{ marginTop: '2rem', borderTop: '1px solid rgba(255, 68, 68, 0.2)', paddingTop: '1rem' }}>
                  <button className="btn btn--danger btn--full" style={{ padding: '6px', fontSize: '0.7rem' }} onClick={handleDeleteGroup}>
                    DELETE VAULT
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="glass-card" style={{ background: 'transparent' }}>
            <div className="section-label">Operatives</div>
            {group.members?.map((m) => (
              <div key={m.central_user_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span style={{ color: m.central_user_id === user.central_user_id ? '#a29bfe' : '#8888a0' }}>
                  {m.username}{m.role === 'admin' && '*'}
                </span>
                <span style={{ color: '#555570' }}>
                  {otherMembers.find(om => om.username === m.username)?.submitted_count || 0} contrib.
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* MAIN AREA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {error && <div className="alert alert--error">{error}</div>}
          {success && <div className="alert alert--success">{success}</div>}

          {/* ADMIN INTEL LOGS */}
          {showAdminLogs && isGroupAdmin && user.is_admin && (
            <section className="glass-card" style={{ borderColor: '#a29bfe', background: 'rgba(162, 155, 254, 0.05)' }}>
              <div className="section-label">Deep Intelligence Logs (SITE ADMIN)</div>
              {!adminLogs ? <div className="loading">Decrypting deep logs...</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ fontSize: '0.85rem', color: '#a29bfe', fontWeight: 'bold' }}>
                    UNRESTRICTED ACCESS: Viewing all secret contents and AI reasoning.
                  </div>
                  {adminLogs.logs.map(log => (
                    <div key={log.id} style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: log.matched ? '1px solid #00b894' : '1px solid #2a2a40' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: log.matched ? '#00b894' : '#8888a0' }}>
                          {log.user_a_name} + {log.user_b_name} &raquo; {Math.round(log.confidence * 100)}% CONFIDENCE
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#555570' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1rem' }}>
                        <div>
                          <div style={{ fontSize: '0.6rem', color: '#555570', marginBottom: '4px' }}>{log.user_a_name.toUpperCase()}'S SECRET</div>
                          <div style={{ fontSize: '0.8rem', fontStyle: 'italic', color: '#e8e8f0' }}>"{log.secret_a_content}"</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.6rem', color: '#555570', marginBottom: '4px' }}>{log.user_b_name.toUpperCase()}'S SECRET</div>
                          <div style={{ fontSize: '0.8rem', fontStyle: 'italic', color: '#e8e8f0' }}>"{log.secret_b_content}"</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#a29bfe', background: 'rgba(162, 155, 254, 0.08)', padding: '10px', borderRadius: '4px', borderLeft: '2px solid #a29bfe' }}>
                        <strong>Full Reasoning:</strong> {log.ai_reasoning}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* OPENED VAULTS (REVEALED MATCHES) */}
          {matches.length > 0 && (
            <section>
              <div className="section-label">Opened Vaults (Revealed)</div>
              {matches.map((m) => {
                const isA = m.user_a_id === user.central_user_id;
                const myName = isA ? m.user_a_name : m.user_b_name;
                const theirName = isA ? m.user_b_name : m.user_a_name;
                const toArray = (v) => Array.isArray(v) ? v : [v];
                const myItems = toArray(isA ? m.obfuscated_a : m.obfuscated_b);
                const theirItems = toArray(isA ? m.obfuscated_b : m.obfuscated_a);

                return (
                  <div key={m.id} className="vault-match glass-card" style={{ border: '1px solid rgba(0, 184, 148, 0.4)' }}>
                    <div className="vault-match__header" style={{ color: '#00b894' }}>
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
                    {m.ai_reasoning && <div className="vault-match__reasoning" style={{ marginTop: '1rem' }}>AI Consensus: "{m.ai_reasoning}"</div>}
                  </div>
                );
              })}
            </section>
          )}

          {/* INTELLIGENCE HISTORY (ALL SUMMARIES) */}
          {comparisons.length > 0 && (
            <section>
              <div className="section-label">Intelligence History (My Results)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {comparisons.map((c) => (
                  <div key={c.id} className="glass-card" style={{ 
                    padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderLeft: c.matched ? '4px solid #00b894' : '4px solid #2a2a40',
                    background: c.matched ? 'rgba(0, 184, 148, 0.05)' : 'rgba(255, 255, 255, 0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span className={`badge badge--${c.matched ? 'matched' : (c.confidence === 0 ? 'danger' : 'sealed')}`} style={{ width: '80px', textAlign: 'center' }}>
                        {c.matched ? 'MATCH' : (c.confidence === 0 ? 'ERROR' : 'NO MATCH')}
                      </span>
                      <div>
                        <div style={{ fontSize: '0.9rem', color: '#e8e8f0' }}>{c.user_summary || 'No summary available.'}</div>
                        {c.confidence === 0 && (
                          <div style={{ fontSize: '0.75rem', color: '#ff7675', marginTop: '4px' }}>
                             Full Reason: {c.ai_reasoning}
                          </div>
                        )}
                        <div style={{ fontSize: '0.7rem', color: '#555570', marginTop: '2px' }}>
                          Intelligence analysis completed {new Date(c.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    {c.matched && <span style={{ fontSize: '1.2rem' }}>&#128275;</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ADD SECRET */}
          <section className="glass-card" style={{ background: 'rgba(162, 155, 254, 0.03)', border: '1px solid rgba(162, 155, 254, 0.2)' }}>
            <div className="section-label">New Contribution</div>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <textarea
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="Sealing a secret... It will only be revealed based on the group's intelligence rules."
                  required
                  style={{ background: 'rgba(10, 10, 15, 0.8)', fontSize: '1.1rem', minHeight: '100px' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: '2rem', alignItems: 'end' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Plausible Deniability ({obfLevel} Decoys)</label>
                  <div className="obfuscation-control">
                    <input type="range" min="0" max="10" value={obfLevel} onChange={(e) => setObfLevel(+e.target.value)} />
                    <span>{obfLevel}</span>
                  </div>
                </div>
                <button type="submit" className="btn btn--primary btn--full" style={{ padding: '12px' }} disabled={!newSecret.trim()}>SEAL SECRET</button>
              </div>
            </form>
          </section>

          {/* MY CONTRIBUTIONS */}
          {secrets.length > 0 && (
            <section>
              <div className="section-label">Your Active Contributions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {secrets.map((s) => (
                  <div key={s.id} className="glass-card card" style={{ marginBottom: 0, padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: '#e8e8f0' }}>{s.content}</span>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <span className={`badge badge--${s.status}`}>{s.status.toUpperCase()}</span>
                        <span className="badge badge--count">{s.obfuscation_level} DECOYS</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {s.status === 'sealed' && (
                        <>
                          <button className="btn btn--primary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleSubmit(s.id)}>SUBMIT</button>
                          <button className="btn btn--danger" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleDelete(s.id)}>DELETE</button>
                        </>
                      )}
                      {s.status === 'submitted' && <button className="btn btn--secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }} onClick={() => handleUnsubmit(s.id)}>UNSUBMIT</button>}
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
