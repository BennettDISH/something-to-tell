import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGroup } from '../services/api';

export default function CreateGroup() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await createGroup(name, description);
      navigate(`/groups/${data.group.id}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 600 }}>
      <div className="section-label" style={{ marginBottom: '2rem' }}>Establish New Vault</div>
      
      <div className="glass-card">
        <h1 className="page-title" style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Group Identity</h1>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>NAME</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inner Circle" required />
          </div>
          <div className="form-group">
            <label>PURPOSE (OPTIONAL)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What secrets will be exchanged here?" rows={3} />
          </div>
          <button type="submit" className="btn btn--primary btn--full" style={{ padding: '1rem' }}>INITIALIZE GROUP</button>
        </form>
      </div>
    </div>
  );
}
