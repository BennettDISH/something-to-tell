import { useState, useEffect } from 'react';
import { getAiConfig, saveAiConfig, deleteAiConfig } from '../services/api';

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
    <div className="page" style={{ maxWidth: 500 }}>
      <h1 className="page-title">Settings</h1>

      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>AI Provider</h3>
        <p style={{ color: '#8888a0', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          Your API key is used to compare secrets and generate decoys. It's stored on the server and only used when you submit a secret.
        </p>

        {error && <div className="alert alert--error">{error}</div>}
        {success && <div className="alert alert--success">{success}</div>}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Provider</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasConfig ? '••••••••  (saved — enter new to update)' : 'Enter your API key'}
              required={!hasConfig}
            />
            <div className="form-hint">
              {provider === 'anthropic'
                ? 'Get your key from console.anthropic.com'
                : 'Get your key from platform.openai.com'}
            </div>
          </div>

          <div className="form-group">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Default</option>
              {currentModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn--primary">
              {hasConfig ? 'Update' : 'Save'} Configuration
            </button>
            {hasConfig && (
              <button type="button" className="btn btn--danger" onClick={handleDelete}>Remove</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
