import { authHeaders } from './authService';

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Groups
export const getGroups = () => request('/api/groups');
export const getGroup = (id) => request(`/api/groups/${id}`);
export const createGroup = (name, description) =>
  request('/api/groups', { method: 'POST', body: JSON.stringify({ name, description }) });
export const updateGroup = (id, fields) =>
  request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(fields) });
export const joinGroup = (code) =>
  request('/api/groups/join', { method: 'POST', body: JSON.stringify({ code }) });
export const leaveGroup = (id) =>
  request(`/api/groups/${id}/leave`, { method: 'DELETE' });

// Secrets
export const getGroupSecrets = (groupId) => request(`/api/secrets/group/${groupId}`);
export const addSecret = (groupId, content, obfuscation_level) =>
  request(`/api/secrets/group/${groupId}`, {
    method: 'POST',
    body: JSON.stringify({ content, obfuscation_level }),
  });
export const submitSecret = (id) =>
  request(`/api/secrets/${id}/submit`, { method: 'PATCH' });
export const unsubmitSecret = (id) =>
  request(`/api/secrets/${id}/unsubmit`, { method: 'PATCH' });
export const triggerCompare = (groupId) =>
  request(`/api/secrets/group/${groupId}/compare`, { method: 'POST' });
export const deleteSecret = (id) =>
  request(`/api/secrets/${id}`, { method: 'DELETE' });

// Admin
export const adminGetGroups = () => request('/api/admin/groups');
export const adminGetGroup = (id) => request(`/api/admin/groups/${id}`);

// AI Config
export const getAiConfig = () => request('/api/ai/config');
export const saveAiConfig = (provider, api_key, model) =>
  request('/api/ai/config', { method: 'PUT', body: JSON.stringify({ provider, api_key, model }) });
export const deleteAiConfig = () =>
  request('/api/ai/config', { method: 'DELETE' });
