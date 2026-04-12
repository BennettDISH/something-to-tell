const API = '/api/auth';

function saveToken(token) {
  localStorage.setItem('token', token);
}

export function getToken() {
  return localStorage.getItem('token');
}

export function clearToken() {
  localStorage.removeItem('token');
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email, password) {
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  saveToken(data.token);
  return data.user;
}

export async function register({ username, email, password, first_name, last_name }) {
  const res = await fetch(`${API}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, first_name, last_name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  saveToken(data.token);
  return data.user;
}

export async function ssoCallback(code) {
  const res = await fetch(`${API}/sso-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  saveToken(data.token);
  return data.user;
}

export async function getProfile() {
  const res = await fetch(`${API}/profile`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Not authenticated');
  const data = await res.json();
  return data.user;
}

export function getSsoLoginUrl() {
  const authUrl = import.meta.env.VITE_AUTH_SERVICE_URL;
  const clientId = import.meta.env.VITE_SSO_CLIENT_ID;
  if (!authUrl || !clientId) return null;
  const state = crypto.randomUUID();
  sessionStorage.setItem('sso_state', state);
  const redirect = `${window.location.origin}/auth/callback`;
  return `${authUrl}/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&state=${state}`;
}
