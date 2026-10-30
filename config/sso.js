const AUTH_URL = process.env.AUTH_SERVICE_URL;
// A Waypoint that never answers would otherwise hold the sign-in request open.
const TIMEOUT_MS = 10_000;

// Waypoint turned the request down (a 4xx): its own sentence, like "Invalid credentials", is
// for the visitor (err.expose). Anything else, a 5xx or a timeout included, stays in the log.
async function refusal(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || fallback);
  if (res.status < 500) err.expose = true;
  return err;
}

export async function centralRegister({ username, email, password, first_name, last_name }) {
  const res = await fetch(`${AUTH_URL}/api/auth/proxy/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username, email, password, first_name, last_name,
      client_id: process.env.SSO_CLIENT_ID,
      client_secret: process.env.SSO_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await refusal(res, 'Registration failed');
  return res.json();
}

export async function centralLogin({ email, password }) {
  const res = await fetch(`${AUTH_URL}/api/auth/proxy/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password,
      client_id: process.env.SSO_CLIENT_ID,
      client_secret: process.env.SSO_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await refusal(res, 'Login failed');
  return res.json();
}

export async function exchangeCode(code) {
  const res = await fetch(`${AUTH_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.SSO_CLIENT_ID,
      client_secret: process.env.SSO_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await refusal(res, 'Code exchange failed');
  return res.json();
}
