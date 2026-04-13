import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { adminGetGroups, adminGetGroup } from '../services/api';

export default function Admin() {
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminGetGroups().then((data) => setGroups(data.groups)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const selectGroup = async (id) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    setDetail(null);
    try {
      const data = await adminGetGroup(id);
      setDetail(data);
    } catch (err) {
      setDetail({ error: err.message });
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="page">
      <h1 className="page-title">Admin</h1>

      <p style={{ color: '#8888a0', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        {groups.length} group{groups.length !== 1 && 's'} total
      </p>

      {groups.map((g) => (
        <div key={g.id}>
          <div
            className="card"
            style={{ cursor: 'pointer', borderColor: selected === g.id ? '#6c5ce7' : undefined }}
            onClick={() => selectGroup(g.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="card__title">{g.name}</div>
                <div className="card__subtitle">
                  Created by {g.created_by_name} &middot; {g.member_count} members &middot; {g.secret_count} secrets &middot; {g.match_count} matches
                </div>
              </div>
              <span className="join-code" style={{ fontSize: '0.8rem' }}>{g.join_code}</span>
            </div>
          </div>

          {selected === g.id && detail && !detail.error && (
            <div style={{ marginLeft: '1rem', marginBottom: '1.5rem' }}>
              {/* Members */}
              <h4 style={{ color: '#8888a0', fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>Members</h4>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {detail.group.members?.map((m) => (
                  <span key={m.central_user_id} style={{
                    padding: '4px 10px', background: '#1a1a2e', borderRadius: 20, fontSize: '0.8rem',
                    border: '1px solid #2a2a40', color: '#8888a0'
                  }}>
                    {m.username} ({m.role})
                  </span>
                ))}
              </div>

              {/* All Secrets */}
              <h4 style={{ color: '#8888a0', fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>
                All Secrets ({detail.secrets.length})
              </h4>
              {detail.secrets.length === 0 ? (
                <p style={{ color: '#555570', fontSize: '0.85rem' }}>No secrets yet.</p>
              ) : (
                detail.secrets.map((s) => (
                  <div key={s.id} className="card" style={{ padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ color: '#a29bfe', fontSize: '0.8rem', marginRight: '0.5rem' }}>{s.username}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem' }}>{s.content}</span>
                      </div>
                      <div>
                        <span className={`badge badge--${s.status}`}>{s.status}</span>
                        {s.obfuscation_level > 0 && (
                          <span className="badge badge--count" style={{ marginLeft: '0.5rem' }}>{s.obfuscation_level} decoys</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Comparison Log (full AI reasoning) */}
              {detail.comparisons?.length > 0 && (
                <>
                  <h4 style={{ color: '#a29bfe', fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>
                    AI Comparison Log ({detail.comparisons.length})
                  </h4>
                  {detail.comparisons.map((c) => (
                    <div key={c.id} className="card" style={{
                      padding: '0.75rem 1rem',
                      borderColor: c.matched ? '#00b894' : '#e17055',
                      borderLeftWidth: 3,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#8888a0' }}>
                          {c.user_a_name} vs {c.user_b_name}
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ color: '#555570', fontSize: '0.75rem' }}>{Math.round(c.confidence * 100)}%</span>
                          <span className={`badge badge--${c.matched ? 'matched' : 'sealed'}`}>
                            {c.matched ? 'Match' : 'No match'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div style={{ background: '#0a0a0f', padding: '0.5rem', borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}>
                          {c.secret_a_content}
                        </div>
                        <div style={{ background: '#0a0a0f', padding: '0.5rem', borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem' }}>
                          {c.secret_b_content}
                        </div>
                      </div>
                      {c.ai_reasoning && (
                        <div style={{ fontSize: '0.8rem', color: '#8888a0', borderLeft: '2px solid #6c5ce7', paddingLeft: '0.75rem' }}>
                          {c.ai_reasoning}
                        </div>
                      )}
                      {c.user_summary && (
                        <div style={{ fontSize: '0.75rem', color: '#555570', marginTop: '0.25rem' }}>
                          User sees: "{c.user_summary}"
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* Matches */}
              {detail.matches.length > 0 && (
                <>
                  <h4 style={{ color: '#00b894', fontSize: '0.85rem', margin: '1rem 0 0.5rem' }}>
                    Vault Matches ({detail.matches.length})
                  </h4>
                  {detail.matches.map((m) => (
                    <div key={m.id} className="vault-match">
                      <div className="vault-match__header">&#128275; {m.user_a_name} &harr; {m.user_b_name}</div>
                      <div className="vault-match__secrets">
                        <div className="vault-match__side">
                          <div className="vault-match__label">{m.user_a_name}'s secret</div>
                          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem' }}>{m.secret_a_content}</p>
                        </div>
                        <div className="vault-match__side">
                          <div className="vault-match__label">{m.user_b_name}'s secret</div>
                          <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9rem' }}>{m.secret_b_content}</p>
                        </div>
                      </div>
                      {m.ai_reasoning && <div className="vault-match__reasoning">"{m.ai_reasoning}"</div>}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {selected === g.id && detail?.error && (
            <div className="alert alert--error" style={{ marginLeft: '1rem', marginBottom: '1rem' }}>{detail.error}</div>
          )}
        </div>
      ))}

      {groups.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__text">No groups exist yet.</div>
        </div>
      )}
    </div>
  );
}
