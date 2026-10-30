// Test kit: an in-memory Postgres (PGlite, the real engine compiled to WASM) served on the
// wire protocol, a stand-in Waypoint that hands out accounts, a stand-in OpenAI that the
// SDK reaches through OPENAI_BASE_URL, and the real server.js run as a child process with
// at-rest encryption on. The tests drive the same routes and `pg` Pool as production.
import fs from 'node:fs';
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

// Building PGlite's data directory (initdb, in WASM) takes seconds of CPU, and the suite starts a
// database 23 times, which on a busy machine is what pushed `npm test` past a time limit. So
// the first database made after an install is dumped to node_modules/.cache, and every later one
// loads that dump (under a second). A missing, unreadable or unwritable cache just means a
// fresh database, as before.
const PGLITE_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@electric-sql', 'pglite', 'package.json'), 'utf8')).version;
const SNAPSHOT = path.join(root, 'node_modules', '.cache', `pglite-${PGLITE_VERSION}.tar`);

async function createPglite() {
  try {
    return await PGlite.create({ loadDataDir: new Blob([await fs.promises.readFile(SNAPSHOT)]) });
  } catch { /* no snapshot yet, or one that will not load: make a fresh database */ }
  const pglite = await PGlite.create();
  try {
    const tmp = `${SNAPSHOT}.${process.pid}`;
    await fs.promises.mkdir(path.dirname(SNAPSHOT), { recursive: true });
    await fs.promises.writeFile(tmp, Buffer.from(await (await pglite.dumpDataDir('none')).arrayBuffer()));
    await fs.promises.rename(tmp, SNAPSHOT); // whole file or nothing, for a run that starts meanwhile
  } catch { /* the cache is only a speed-up */ }
  return pglite;
}

export async function startPostgres() {
  const pglite = await createPglite();
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

// POST /oauth/token exchanges a code that issueCode() handed out for an account made by
// newAccount() (a new central account per call, ids from 1000 up); it stands in for a user
// approving the app on Waypoint. POST /api/auth/proxy/login accepts one account,
// mira@example.com / right-password. GUEST_EMAIL comes back from login and register as a
// Waypoint guest, to prove the app refuses a guest on every route. `calls` counts what reaches
// each route, so tests can see what the app's own limits kept out.
const GUEST_EMAIL = 'guest@example.test';

async function startWaypoint() {
  let nextId = 1000;
  let nextCode = 1;
  const codes = new Map(); // code -> account
  const calls = { token: 0, login: 0, register: 0 };
  const newAccount = (extra = {}) => {
    const id = nextId++;
    return { central_user_id: id, username: `user${id}`, email: `user${id}@example.test`, first_name: `User${id}`, last_name: '', is_guest: false, ...extra };
  };
  const guestAccount = () => newAccount({ username: `guest-swift-otter-${nextId}`, email: null, first_name: '', is_guest: true });
  const server = await jsonServer((req, body, send) => {
    if (req.method === 'POST' && req.url === '/oauth/token') {
      calls.token++;
      if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) return send(401, { error: 'bad client' });
      const account = body.grant_type === 'authorization_code' && codes.get(body.code);
      if (!account) return send(400, { error: 'invalid_grant' });
      codes.delete(body.code);
      return send(200, account);
    }
    if (req.method === 'POST' && req.url === '/api/auth/proxy/register') {
      calls.register++;
      if (body.email === GUEST_EMAIL) return send(201, guestAccount());
      return send(400, { error: 'Registration failed' });
    }
    if (req.method === 'POST' && req.url === '/api/auth/proxy/login') {
      calls.login++;
      if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) return send(401, { error: 'bad client' });
      if (body.email === GUEST_EMAIL) return send(200, guestAccount());
      if (body.email !== 'mira@example.com' || body.password !== 'right-password') return send(401, { error: 'Invalid credentials' });
      return send(200, { central_user_id: 500, username: 'mira', email: 'mira@example.com', first_name: 'Mira', last_name: '', is_guest: false });
    }
    send(404, { error: 'not found' });
  });
  return {
    ...server,
    calls,
    newAccount,
    guestAccount,
    issueCode(account) {
      const code = `code-${nextCode++}`;
      codes.set(code, account);
      return code;
    },
  };
}

// The text inside one of the prompt's fenced <secret_a>/<secret_b> blocks.
const fenced = (prompt, label) => prompt.match(new RegExp(`<${label} nonce="[^"]+">\\n([\\s\\S]*?)\\n</${label}>`))?.[1];

// Chat completions. A comparison prompt "matches" when the word "alpha" appears in both
// secrets (twice in the prompt); its reasoning quotes both secrets, as a real model's does.
// A decoy prompt gets two fixed decoys back. Every call's Authorization header is kept so
// tests can see which API key the app sent. A comparison with "slow" in a secret is held
// until release(), so a test can act while the AI is answering (waiting() counts them).
async function startOpenAI() {
  const calls = [];
  const held = [];
  const server = await jsonServer((req, body, send) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } });
    const system = body.messages.find((m) => m.role === 'system')?.content || '';
    const user = body.messages.find((m) => m.role === 'user')?.content || '';
    calls.push({ authorization: req.headers.authorization, model: body.model, kind: /decoy/i.test(system) ? 'decoys' : 'compare' });
    let content;
    if (/decoy/i.test(system)) {
      const decoys = ['I once ate a whole cake alone', 'I still sleep with a nightlight'];
      // Other shapes a model replies with: decoys keyed by number, or none at all.
      if (/numbered/.test(user)) content = JSON.stringify({ 1: decoys[0], 2: decoys[1] });
      else if (/nodecoys/.test(user)) content = JSON.stringify({ fakes: [] });
      else content = JSON.stringify({ fakes: decoys });
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
      // A room rule asking to "copy both secrets" is obeyed the way an obliging model
      // would, with the wording disguised (reversed) so no word-matching filter sees it.
      if (/copy both secrets/i.test(user)) {
        const reversed = (s) => [...(s || '')].reverse().join('');
        content = JSON.stringify({
          ...JSON.parse(content),
          user_summary: `As the room asked: ${reversed(fenced(user, 'secret_a'))} / ${reversed(fenced(user, 'secret_b'))}`,
        });
      }
      // A secret containing "garbled" gets itself echoed back instead of JSON.
      const garbled = [fenced(user, 'secret_a'), fenced(user, 'secret_b')].find((s) => /garbled/.test(s || ''));
      if (garbled) content = garbled;
    }
    const reply = () => send(200, {
      id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    if (!/decoy/i.test(system) && /slow/.test(user)) held.push(reply);
    else reply();
  });
  return { ...server, calls, waiting: () => held.length, release: () => held.splice(0).forEach((reply) => reply()) };
}

/** Start Postgres, the stand-ins and the app. Returns helpers and stop(). Pass `db` (from
 *  startPostgres) to boot against an existing database; stop() then leaves it running.
 *  `env` overrides the server's environment (an empty string unsets a variable). */
export async function startApp({ adminCentralUserIds = '', db: sharedDb, env = {} } = {}) {
  const db = sharedDb || await startPostgres();
  const waypoint = await startWaypoint();
  // Sign-in is limited per address, so each user() comes from its own address, the way real
  // visitors do behind Railway's proxy (trust proxy 1 reads the last X-Forwarded-For entry).
  // Later requests carry no such header and come from 127.0.0.1.
  let nextVisitor = 0;
  const newVisitorAddress = () => `10.9.${nextVisitor >> 8}.${nextVisitor++ & 255}`;
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
      ...env,
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

  const request = async (method, url, { token, body, headers: extraHeaders } = {}) => {
    const headers = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, body: data, headers: res.headers };
  };

  return {
    base,
    db,
    openai,
    waypoint,
    GUEST_EMAIL,
    request,
    log: () => log,
    /** Sign a new Waypoint account in through the real SSO callback; `as` is a request function
     *  bound to the token. */
    async user() {
      const code = waypoint.issueCode(waypoint.newAccount());
      const res = await request('POST', '/api/auth/sso-callback', { body: { code }, headers: { 'X-Forwarded-For': newVisitorAddress() } });
      if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
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
