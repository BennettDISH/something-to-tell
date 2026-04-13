import { useState, useEffect } from 'react';
import { getAiConfig, saveAiConfig, deleteAiConfig, testAiConnection } from '../services/api';

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', models: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20251001'] },
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
];

export default function Settings() {
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [hasConfig, setHasConfig] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getAiConfig().then((data) => {
      if (data.config) {
        setProvider(data.config.provider);
        setModel(data.config.model || '');
        setHasConfig(true);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const currentModels = PROVIDERS.find((p) => p.value === provider)?.models || [];

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await saveAiConfig(provider, apiKey, model || currentModels[0]);
      setSuccess('AI configuration saved.');
      setHasConfig(true);
      setApiKey('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteAiConfig();
      setProvider('anthropic');
      setApiKey('');
      setModel('');
      setHasConfig(false);
      setSuccess('AI configuration removed.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <div className="section-label" style={{ marginBottom: '2rem' }}>System Configuration</div>
      
      <div className="glass-card">
        <h1 className="page-title" style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>AI Intelligence</h1>
        <p style={{ color: '#8888a0', fontSize: '0.85rem', marginBottom: '2rem', lineHeight: '1.4' }}>
          Configure the AI brain used for secret comparison and decoy generation. 
          Your API key is stored securely and only invoked during active comparison cycles.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>PROVIDER</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>API KEY</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasConfig ? '••••••••  (STORED)' : 'ENTER API KEY'}
              required={!hasConfig}
              style={{ fontFamily: 'monospace', letterSpacing: '2px' }}
            />
            <div className="form-hint">
              {provider === 'anthropic'
                ? 'Acquire from console.anthropic.com'
                : 'Acquire from platform.openai.com'}
            </div>
          </div>

          <div className="form-group">
            <label>LLM MODEL</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">DEFAULT SELECTION</option>
              {currentModels.map((m) => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button type="submit" className="btn btn--primary" style={{ flex: 1, padding: '12px' }}>
              {hasConfig ? 'UPDATE' : 'INITIALIZE'} CONFIG
            </button>
            {hasConfig && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  style={{ padding: '12px' }}
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true); setError(''); setSuccess('');
                    try {
                      const result = await testAiConnection();
                      setSuccess(`Connection successful — AI replied: "${result.reply}"`);
                    } catch (err) {
                      setError(`Connection failed — ${err.message}`);
                    } finally { setTesting(false); }
                  }}
                >
                  {testing ? 'TESTING...' : 'TEST'}
                </button>
                <button type="button" className="btn btn--danger" style={{ padding: '12px' }} onClick={handleDelete}>PURGE</button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
