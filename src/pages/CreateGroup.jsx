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
    <div className="page" style={{ maxWidth: 500 }}>
      <h1 className="page-title">Create a Group</h1>

      {error && <div className="alert alert--error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Group Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Close Friends" required />
        </div>
        <div className="form-group">
          <label>Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this group about?" />
        </div>
        <button type="submit" className="btn btn--primary btn--full">Create Group</button>
      </form>
    </div>
  );
}
