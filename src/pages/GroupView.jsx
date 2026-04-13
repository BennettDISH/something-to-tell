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
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{group.name}</h1>
        <span className="badge badge--count">{group.members?.length} members</span>
      </div>
      {group.description && <p style={{ color: '#8888a0', marginBottom: '1rem' }}>{group.description}</p>}

      <div style={{ marginBottom: '1.5rem' }}>
        <span style={{ color: '#555570', fontSize: '0.8rem' }}>Join code: </span>
        <span className="join-code" onClick={copyCode} title="Click to copy">{group.join_code}</span>
      </div>

      {/* Members */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {group.members?.map((m) => (
          <span key={m.central_user_id} style={{
            padding: '4px 10px', background: '#1a1a2e', borderRadius: 20, fontSize: '0.8rem',
            border: '1px solid #2a2a40', color: m.central_user_id === user.central_user_id ? '#a29bfe' : '#8888a0'
          }}>
            {m.username}{m.role === 'admin' && ' *'}
          </span>
        ))}
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {success && <div className="alert alert--success">{success}</div>}

      {/* AI Instructions (group admin only) */}
      {isGroupAdmin && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editingPrompt ? '0.75rem' : 0 }}>
            <h3 style={{ fontSize: '1rem', margin: 0 }}>AI Instructions</h3>
            {!editingPrompt && (
              <button className="btn btn--secondary" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => setEditingPrompt(true)}>
                {group.ai_prompt ? 'Edit' : 'Set up'}
              </button>
            )}
          </div>
          {!editingPrompt && group.ai_prompt && (
            <p style={{ color: '#8888a0', fontSize: '0.85rem', marginTop: '0.5rem', fontStyle: 'italic' }}>"{group.ai_prompt}"</p>
          )}
          {!editingPrompt && !group.ai_prompt && (
            <p style={{ color: '#555570', fontSize: '0.8rem', marginTop: '0.5rem' }}>No custom instructions — using default matching.</p>
          )}
          {editingPrompt && (
            <>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder='e.g. "Tell us if we are both thinking the same thing about each other" or "Match secrets that reveal the same fear"'
                  rows={3}
                />
                <div className="form-hint">Tell the AI how to judge whether two secrets match.</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn--primary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={handleSavePrompt}>Save</button>
                <button className="btn btn--secondary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => { setEditingPrompt(false); setAiPrompt(group.ai_prompt || ''); }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add a secret */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Add a Secret</h3>
        <form onSubmit={handleAdd}>
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
          <button type="submit" className="btn btn--primary" disabled={!newSecret.trim()}>
            Seal Secret
          </button>
        </form>
      </div>

      {/* Other members' submission status */}
      {otherMembers.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#8888a0' }}>Other Members</h3>
          {otherMembers.map((m) => (
            <div key={m.username} style={{ padding: '0.5rem 0', color: '#555570', fontSize: '0.9rem' }}>
              {m.username}: {m.submitted_count} submitted, {m.total_count} total
            </div>
          ))}
        </div>
      )}

      {/* Admin: trigger comparison */}
      {isGroupAdmin && (
        <div className="card" style={{ marginBottom: '1.5rem', borderColor: '#6c5ce7' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Run Comparison</h3>
          <p style={{ color: '#8888a0', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {submittedStats?.submitted_count > 0
              ? `${submittedStats.submitted_count} secret${submittedStats.submitted_count > 1 ? 's' : ''} submitted by ${submittedStats.submitters} member${submittedStats.submitters > 1 ? 's' : ''}, ready for AI comparison.`
              : 'No secrets submitted yet. Members need to submit their secrets first.'}
          </p>
          <button
            className="btn btn--primary"
            disabled={comparing || !submittedStats || submittedStats.submitted_count < 2}
            onClick={handleCompare}
          >
            {comparing ? 'Comparing with AI...' : 'Compare Submitted Secrets'}
          </button>
        </div>
      )}

      {/* Comparison Results (user view — safe summaries only) */}
      {comparisons.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#8888a0' }}>Last Comparison Results</h3>
          {comparisons.map((c) => (
            <div key={c.id} className="card" style={{
              padding: '0.75rem 1rem',
              borderColor: c.matched ? '#00b894' : '#2a2a40',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span className={`badge badge--${c.matched ? 'matched' : 'sealed'}`}>
                  {c.matched ? 'Matched' : 'No match'}
                </span>
                <span style={{ color: '#555570', fontSize: '0.75rem' }}>
                  {Math.round(c.confidence * 100)}% confidence
                </span>
              </div>
              {c.user_summary && (
                <p style={{ color: '#8888a0', fontSize: '0.85rem', margin: 0 }}>{c.user_summary}</p>
              )}
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

      {/* My secrets */}
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
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                {s.status === 'sealed' && (
                  <>
                    <button className="btn btn--primary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => handleSubmit(s.id)}>Submit</button>
                    <button className="btn btn--danger" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => handleDelete(s.id)}>Delete</button>
                  </>
                )}
                {s.status === 'submitted' && (
                  <button className="btn btn--secondary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => handleUnsubmit(s.id)}>Unsubmit</button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
