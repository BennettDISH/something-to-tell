// Test kit: an in-memory Postgres (PGlite, the real engine compiled to WASM) served on the
// wire protocol, a stand-in Waypoint that mints guest accounts, a stand-in OpenAI that the
// SDK reaches through OPENAI_BASE_URL, and the real server.js run as a child process with
// at-rest encryption on. The tests drive the same routes and `pg` Pool as production.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_ID = 'test-client';
const CLIENT_SECRET = 'test-secret';
export const JWT_SECRET = 'test-jwt-secret';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export async function startPostgres() {
  const pglite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 20 });
  await server.start();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${server.port}/postgres`,
    /** Straight to the database, not through the app. */
    query: (text, params) => pglite.query(text, params),
    async stop() {
      // Closed client connections are detached asynchronously, and a detach that reaches a
      // closed PGlite throws outside any test. Let them drain first.
      for (let i = 0; i < 100 && server.getStats().activeConnections > 0; i++) await sleep(20);
      await server.stop().catch(() => {});
      await sleep(100);
      await pglite.close().catch(() => {});
    },
  };
}

function jsonServer(handler) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    handler(req, body, send);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => server.close(r)),
  })));
}

// POST /api/auth/proxy/guest mints a new central account per call (ids from 1000 up).
function startWaypoint() {
  let nextId = 1000;
  return jsonServer((req, body, send) => {
    if (req.method === 'POST' && req.url === '/api/auth/proxy/guest') {
      if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) return send(401, { error: 'bad client' });
      const id = nextId++;
      return send(200, { central_user_id: id, username: `guest${id}`, email: null, first_name: `Guest${id}`, last_name: '', is_guest: true });
    }
    send(404, { error: 'not found' });
  });
}

// The text inside one of the prompt's fenced <secret_a>/<secret_b> blocks.
const fenced = (prompt, label) => prompt.match(new RegExp(`<${label} nonce="[^"]+">\\n([\\s\\S]*?)\\n</${label}>`))?.[1];

// Chat completions. A comparison prompt "matches" when the word "alpha" appears in both
// secrets (twice in the prompt); its reasoning quotes both secrets, as a real model's does.
// A decoy prompt gets two fixed decoys back. Every call's Authorization header is kept so
// tests can see which API key the app sent.
async function startOpenAI() {
  const calls = [];
  const server = await jsonServer((req, body, send) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } });
    const system = body.messages.find((m) => m.role === 'system')?.content || '';
    const user = body.messages.find((m) => m.role === 'user')?.content || '';
    calls.push({ authorization: req.headers.authorization, model: body.model, kind: /decoy/i.test(system) ? 'decoys' : 'compare' });
    let content;
    if (/decoy/i.test(system)) {
      content = JSON.stringify({ fakes: ['I once ate a whole cake alone', 'I still sleep with a nightlight'] });
    } else {
      const match = (user.match(/alpha/g) || []).length >= 2;
      content = JSON.stringify({
        match,
        confidence: match ? 0.9 : 0.1,
        reasoning: match
          ? `Both are about the same pet: "${fenced(user, 'secret_a')}" and "${fenced(user, 'secret_b')}".`
          : 'Different topics.',
        user_summary: match ? 'You both shared something about pets.' : 'Your secrets were about different things.',
      });
    }
    send(200, {
      id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  return { ...server, calls };
}

/** Start Postgres, the stand-ins and the app. Returns helpers and stop(). Pass `db` (from
 *  startPostgres) to boot against an existing database; stop() then leaves it running. */
export async function startApp({ adminCentralUserIds = '', db: sharedDb } = {}) {
  const db = sharedDb || await startPostgres();
  const waypoint = await startWaypoint();
  const openai = await startOpenAI();
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: db.url,
      JWT_SECRET,
      ENCRYPTION_KEY: 'test-encryption-key',
      AUTH_SERVICE_URL: waypoint.url,
      SSO_CLIENT_ID: CLIENT_ID,
      SSO_CLIENT_SECRET: CLIENT_SECRET,
      ADMIN_CENTRAL_USER_IDS: adminCentralUserIds,
      OPENAI_BASE_URL: `${openai.url}/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;

  // The server only listens once initDb() has built the schema.
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const request = async (method, url, { token, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, body: data };
  };

  return {
    base,
    db,
    openai,
    request,
    log: () => log,
    /** Sign in through the real guest flow; `as` is a request function bound to the token. */
    async guest() {
      const res = await request('POST', '/api/auth/guest');
      if (res.status !== 200) throw new Error(`guest sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
      const { token, user } = res.body;
      return { token, user, as: (method, url, body) => request(method, url, { token, body }) };
    },
    async stop() {
      child.kill();
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      await openai.stop();
      await waypoint.stop();
      if (!sharedDb) await db.stop();
    },
  };
}
