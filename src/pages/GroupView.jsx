import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getGroup, updateGroup, getGroupSecrets, addSecret, submitSecret, unsubmitSecret, triggerCompare, deleteSecret, getAdminLogs, deleteGroup } from '../services/api';

const PURPOSES = [
  { value: 'fun', label: 'Fun & Games', icon: '\u{1F389}', description: 'Lighthearted, silly, embarrassing confessions — keep it playful' },
  { value: 'heart', label: 'Heart-to-Heart', icon: '\u{1F497}', description: 'Feelings, relationships, crushes, love — the emotional stuff' },
  { value: 'weight', label: 'Weight Off Your Chest', icon: '\u{1F32C}\u{FE0F}', description: 'Deep confessions, guilt, regrets — things you need to let go of' },
  { value: 'dreams', label: 'Dreams & Ambitions', icon: '\u{2728}', description: 'Goals, aspirations, bucket list items — what you hope for' },
  { value: 'fears', label: 'Fears & Vulnerabilities', icon: '\u{1F30A}', description: 'Insecurities, anxieties, things that keep you up at night' },
  { value: 'custom', label: 'Custom', icon: '\u{1F527}', description: 'Define your own context for this room' },
];

const STRATEGIES = [
  { value: 'topic', label: 'Same Topic', description: 'Both secrets are about the same subject, even if worded differently' },
  { value: 'feeling', label: 'Same Feeling', description: 'Both express the same core emotion — love, guilt, excitement, shame' },
  { value: 'weight', label: 'Same Weight', description: 'Both carry a similar level of seriousness or gravity' },
  { value: 'vibe', label: 'Same Vibe', description: 'Loose, intuitive matching based on overall energy and tone' },
  { value: 'exact', label: 'Near-Identical', description: 'Only match when secrets are about the exact same specific thing' },
  { value: 'custom', label: 'Custom Logic', description: 'Write your own matching rules for the AI' },
];

const STRICTNESS_LABELS = ['', 'Very Loose', 'Loose', 'Balanced', 'Strict', 'Very Strict'];

function RulesModal({ roomConfig, onSave, onClose }) {
  const [purpose, setPurpose] = useState(roomConfig?.purpose || '');
  const [customPurpose, setCustomPurpose] = useState(roomConfig?.custom_purpose || '');
  const [strategy, setStrategy] = useState(roomConfig?.strategy || '');
  const [customStrategy, setCustomStrategy] = useState(roomConfig?.custom_strategy || '');
  const [strictness, setStrictness] = useState(roomConfig?.strictness || 3);
  const [additionalGuidance, setAdditionalGuidance] = useState(roomConfig?.additional_guidance || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      purpose,
      custom_purpose: purpose === 'custom' ? customPurpose : '',
      strategy,
      custom_strategy: strategy === 'custom' ? customStrategy : '',
      strictness,
      additional_guidance: additionalGuidance,
    });
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>Room Intelligence Rules</h2>
          <p>Configure how the AI evaluates and matches secrets in this room.</p>
        </div>

        <div className="modal-body">
          {/* PURPOSE */}
          <div className="modal-section">
            <div className="modal-section__label">What is this room for?</div>
            <div className="modal-section__hint">This helps the AI understand the context and tone of secrets being shared.</div>
            <div className="option-grid">
              {PURPOSES.map((p) => (
                <button
                  key={p.value}
                  className={`option-card ${purpose === p.value ? 'option-card--selected' : ''}`}
                  onClick={() => setPurpose(p.value)}
                >
                  <span className="option-card__icon">{p.icon}</span>
                  <span className="option-card__label">{p.label}</span>
                  <span className="option-card__desc">{p.description}</span>
                </button>
              ))}
            </div>
            {purpose === 'custom' && (
              <textarea
                className="modal-textarea"
                value={customPurpose}
                onChange={(e) => setCustomPurpose(e.target.value)}
                placeholder="Describe what this room is about and what kind of secrets people will be sharing..."
                rows={3}
              />
            )}
          </div>

          {/* STRATEGY */}
          <div className="modal-section">
            <div className="modal-section__label">What counts as a match?</div>
            <div className="modal-section__hint">How should the AI decide if two secrets are related?</div>
            <div className="option-list">
              {STRATEGIES.map((s) => (
                <button
                  key={s.value}
                  className={`option-row ${strategy === s.value ? 'option-row--selected' : ''}`}
                  onClick={() => setStrategy(s.value)}
                >
                  <div className="option-row__radio">{strategy === s.value ? '\u25C9' : '\u25CB'}</div>
                  <div>
                    <div className="option-row__label">{s.label}</div>
                    <div className="option-row__desc">{s.description}</div>
                  </div>
                </button>
              ))}
            </div>
            {strategy === 'custom' && (
              <textarea
                className="modal-textarea"
                value={customStrategy}
                onChange={(e) => setCustomStrategy(e.target.value)}
                placeholder="Describe your matching logic... e.g. 'Match if both secrets are something the person wants to tell a specific other person'"
                rows={3}
              />
            )}
          </div>

          {/* STRICTNESS */}
          <div className="modal-section">
            <div className="modal-section__label">Match Sensitivity</div>
            <div className="modal-section__hint">How generous or strict should the AI be when deciding if two secrets match?</div>
            <div className="strictness-control">
              <div className="strictness-labels">
                <span>Generous</span>
                <span className="strictness-value">{STRICTNESS_LABELS[strictness]}</span>
                <span>Strict</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                value={strictness}
                onChange={(e) => setStrictness(+e.target.value)}
                className="strictness-slider"
              />
              <div className="strictness-dots">
                {[1,2,3,4,5].map(n => (
                  <span key={n} className={`strictness-dot ${strictness === n ? 'strictness-dot--active' : ''}`} />
                ))}
              </div>
            </div>
          </div>

          {/* ADDITIONAL GUIDANCE */}
          <div className="modal-section">
            <div className="modal-section__label">Additional Guidance <span style={{ fontWeight: 400, color: '#555570' }}>(optional)</span></div>
            <div className="modal-section__hint">Any extra instructions for the AI judge. This is appended to the rules above.</div>
            <textarea
              className="modal-textarea"
              value={additionalGuidance}
              onChange={(e) => setAdditionalGuidance(e.target.value)}
              placeholder="e.g. 'Be extra careful not to match secrets that are only superficially similar' or 'We're all coworkers so work-related secrets are expected'"
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--secondary" onClick={onClose} style={{ padding: '10px 24px' }}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving} style={{ padding: '10px 32px' }}>
            {saving ? 'Saving...' : 'Save Rules'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getRuleSummary(rc) {
  if (!rc || (!rc.purpose && !rc.strategy)) return null;
  const purposeLabel = PURPOSES.find(p => p.value === rc.purpose)?.label;
  const strategyLabel = STRATEGIES.find(s => s.value === rc.strategy)?.label;
  const parts = [];
  if (purposeLabel) parts.push(purposeLabel);
  if (strategyLabel) parts.push(strategyLabel);
  if (rc.strictness) parts.push(STRICTNESS_LABELS[rc.strictness]);
  return parts.join(' / ');
}

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

  const [showRulesModal, setShowRulesModal] = useState(false);

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

  const handleSaveRules = async (roomConfig) => {
    setError('');
    try {
      await updateGroup(id, { room_config: roomConfig });
      setShowRulesModal(false);
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

  const ruleSummary = getRuleSummary(group.room_config);

  return (
    <div className="container">
      {showRulesModal && (
        <RulesModal
          roomConfig={group.room_config || {}}
          onSave={handleSaveRules}
          onClose={() => setShowRulesModal(false)}
        />
      )}

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

                <div style={{ marginBottom: '1rem' }}>
                  {ruleSummary ? (
                    <div style={{ fontSize: '0.75rem', color: '#a29bfe', fontWeight: 'bold', marginBottom: '0.5rem', lineHeight: '1.4' }}>
                      {ruleSummary}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: '#555570', marginBottom: '0.5rem' }}>
                      No rules configured yet
                    </div>
                  )}
                  <button className="btn btn--secondary btn--full" style={{ padding: '8px', fontSize: '0.75rem' }} onClick={() => setShowRulesModal(true)}>
                    CONFIGURE RULES
                  </button>
                </div>

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
