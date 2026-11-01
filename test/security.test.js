// The fleet's security checks (fleet-kit/test/security) on this app's own routes, against the real
// server.js in this process, a real (in-memory) Postgres and the stand-ins for Waypoint and the AI.
// A new route has to be public, the site admin's, or reach a room through an id named below, or
// this fails. Then what the kit can't know about this app: who can read whose secret.
import { securityChecks, appListening, listRoutes, fillPath, send } from 'fleet-kit/test/security';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { startPostgres, startWaypoint, startOpenAI, CLIENT_ID, CLIENT_SECRET, JWT_SECRET } from './helpers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const SHELL = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>';
const ADMIN_ID = 1000; // the stand-in Waypoint's first account

const db = await startPostgres();
const waypoint = await startWaypoint();
const openai = await startOpenAI();
const madeDist = !fs.existsSync(DIST);
if (madeDist) {
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  fs.writeFileSync(DIST, SHELL);
}
Object.assign(process.env, {
  PORT: '0',
  NODE_ENV: 'test',
  DATABASE_URL: db.url,
  JWT_SECRET,
  ENCRYPTION_KEY: 'test-encryption-key',
  AUTH_SERVICE_URL: waypoint.url,
  SSO_CLIENT_ID: CLIENT_ID,
  SSO_CLIENT_SECRET: CLIENT_SECRET,
  ADMIN_CENTRAL_USER_IDS: String(ADMIN_ID),
  OPENAI_BASE_URL: `${openai.url}/v1`,
  ANTHROPIC_BASE_URL: openai.url, // only the stand-in, whichever provider a route picks
});
await import('../server.js');
const { default: pool } = await import('../config/db.js');
const { app, server, base } = await appListening();
console.log = () => {}; // a walk is thousands of requests

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await openai.stop();
  await waypoint.stop();
  await db.stop();
  if (madeDist) fs.rmSync(path.dirname(DIST), { recursive: true, force: true });
});

const parsed = (r) => {
  try { return { ...r, json: JSON.parse(r.body) }; } catch { return r; }
};

// Signed in through the real SSO callback. `as` answers the parsed body in `json`.
async function signIn(account = waypoint.newAccount()) {
  const res = parsed(await send(base, '/api/auth/sso-callback', { method: 'POST', body: { code: waypoint.issueCode(account) } }));
  assert.equal(res.status, 200);
  const headers = { authorization: `Bearer ${res.json.token}` };
  return {
    token: res.json.token,
    user: res.json.user,
    headers,
    as: async (method, url, body) => parsed(await send(base, url, { method, headers, body })),
  };
}

// A room whose admin has an AI key, someone who joins it with the code, and a secret they write,
// submitted unless it says `sealed`.
async function newRoom(admin, config) {
  const { json: { group } } = await admin.as('POST', '/api/groups', { name: 'Room' });
  if (config) assert.equal((await admin.as('PUT', `/api/groups/${group.id}`, { room_config: config })).status, 200);
  assert.equal((await admin.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-room-admin' })).status, 200);
  return group;
}
async function member(group) {
  const who = await signIn();
  assert.equal((await who.as('POST', '/api/groups/join', { code: group.join_code })).status, 201);
  return who;
}
async function write(who, group, content, { sealed = false } = {}) {
  const res = await who.as('POST', `/api/secrets/group/${group.id}`, { content });
  assert.equal(res.status, 201);
  if (!sealed) assert.equal((await who.as('PATCH', `/api/secrets/${res.json.secret.id}/submit`)).status, 200);
  return res.json.secret;
}

const boss = await signIn();
assert.equal(boss.user.central_user_id, ADMIN_ID);
const ann = await signIn();
const bob = await signIn();

// Ann and Bob share nothing. One :id means a room in /api/groups/:id and a secret in
// /api/secrets/:id/submit; these are the first of each, so one number names both for the walk.
const { json: { group: annsRoom } } = await ann.as('POST', '/api/groups', { name: "Ann's room" });
const { json: { secret: annsSecret } } = await ann.as('POST', `/api/secrets/group/${annsRoom.id}`, { content: 'Ann keeps a sealed note' });
assert.equal(annsSecret.id, annsRoom.id);
const { json: { group: bobsRoom } } = await bob.as('POST', '/api/groups', { name: "Bob's room" });
await bob.as('POST', `/api/secrets/group/${bobsRoom.id}`, { content: 'Bob keeps a sealed note' });

// A Waypoint guest is refused before a profile or a token is made, so no guest can hold a session.
// The guest here holds what one would have if that ever gave way: a good token for its id. It's
// only refused while the refused sign-in below really left no profile behind.
const guestAccount = waypoint.guestAccount();
const guestSignIn = parsed(await send(base, '/api/auth/sso-callback', { method: 'POST', body: { code: waypoint.issueCode(guestAccount) } }));
const guest = {
  authorization: `Bearer ${jwt.sign({ central_user_id: guestAccount.central_user_id, username: guestAccount.username }, JWT_SECRET, { expiresIn: '1h' })}`,
};

// Express 4 writes the catch-all as '*', the table reads it as '/*', and in a kit pattern * means
// anything: 'GET /*' on `public` would make every GET public and skip it in every check. So the
// checks get the table without that one route. The first test below pins what it answers.
const isPage = (layer) => layer.route?.path === '*' && layer.route.methods.get;
const stack = app._router.stack;
const table = { stack: stack.filter((layer) => !isPage(layer)) };

const PUBLIC = ['POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/sso-callback', 'GET /health'];
const nameOf = (route) => `${route.method} ${route.path}`;
const GET_ROUTES = listRoutes(table).filter((route) => route.method === 'GET');

const checks = securityChecks({
  app: table,
  base,
  as: { user: () => ann.headers, other: () => bob.headers, guest: () => guest, admin: () => boss.headers },
  public: PUBLIC,
  admin: ['/api/admin/*'],
  // The same app shell for everyone, with no data in it: /api/admin/* decides, on its own.
  adminPages: ['/admin'],
  closed: ['POST /api/auth/guest'],
  // No crossSite. The session is a Bearer token the page reads from localStorage, and no route sets
  // or reads a cookie, so a browser adds nothing to another site's request. A cookie session would
  // change that: the test below fails then, and this check has to come on with a guard.
  noStore: {},
  owned: {
    params: { id: () => annsRoom.id, groupId: () => annsRoom.id },
    // Takes only the asker out: a stranger's call answers 200 and changes nothing (tested below).
    except: ['DELETE /api/groups/:id/leave'],
  },
  // Every route that isn't public.
  guests: { refused: listRoutes(table).map(nameOf).filter((name) => !PUBLIC.includes(name)) },
  headers: { path: '/' },
});
for (const check of checks) test(check.name, check.run);

test('the one route the checks leave out only answers the page', async () => {
  assert.equal(stack.filter(isPage).length, 1);
  for (const url of ['/', '/admin', '/groups/1', '/some/page']) {
    const r = await send(base, url, { headers: ann.headers });
    assert.equal(r.status, 200, url);
    assert.match(String(r.headers['content-type']), /text\/html/, url);
    assert.match(r.body, /<div id="root">/, url);
    assert.ok(!r.body.includes('Ann keeps'), url);
  }
});

test('the session is the Authorization header and nothing else, so another site has nothing to ride on', async () => {
  for (const name of ['token', 'session', 'jwt', 'auth', 'authorization']) {
    const r = await send(base, '/api/groups', { headers: { cookie: `${name}=${ann.token}` } });
    assert.equal(r.status, 401, `a good token in a ${name} cookie`);
  }
  const signedIn = await send(base, '/api/auth/sso-callback', { method: 'POST', body: { code: waypoint.issueCode(waypoint.newAccount()) } });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers['set-cookie'], undefined);
});

test('a guest gets no token and leaves no profile', async () => {
  assert.equal(guestSignIn.status, 403);
  assert.equal(guestSignIn.json.token, undefined);
  const { rows } = await db.query('SELECT 1 FROM profiles WHERE central_user_id = $1', [guestAccount.central_user_id]);
  assert.equal(rows.length, 0);
});

test('someone from another room can neither write to this one nor change anything in it', async () => {
  // The walk's empty body stops at the route's own check of it, so with a real one too.
  const writes = await bob.as('POST', `/api/secrets/group/${annsRoom.id}`, { content: 'planted by Bob' });
  assert.equal(writes.status, 403);

  // Leaving takes out only the asker's own row, and Bob has none here.
  assert.equal((await bob.as('DELETE', `/api/groups/${annsRoom.id}/leave`)).status, 200);
  const room = await ann.as('GET', `/api/groups/${annsRoom.id}`);
  assert.deepEqual(room.json.group.members.map((m) => m.central_user_id), [ann.user.central_user_id]);

  // Everything the walk tried as Bob, by the id of Ann's room and her secret, did nothing.
  const view = await ann.as('GET', `/api/secrets/group/${annsRoom.id}`);
  assert.deepEqual(view.json.secrets.map((s) => [s.id, s.status, s.content]), [[annsSecret.id, 'sealed', 'Ann keeps a sealed note']]);
  assert.equal(room.json.group.name, "Ann's room");
});

// Every GET the app has, as this person, with the room's id for each id: the words `hidden` are in
// none of them. A new route that hands a secret out fails here without anyone naming it. The site
// admin's routes are in the walk too, and answer these people 403; the site admin reads every
// secret there on purpose (test/admin.test.js).
async function sees(who, group, hidden, label) {
  for (const route of GET_ROUTES) {
    const url = fillPath(route.path, { id: group.id, groupId: group.id });
    const r = await send(base, url, { headers: who.headers });
    for (const text of hidden) assert.ok(!r.body.includes(text), `${label} read "${text}" at ${url}`);
  }
}

test("no route shows one member another member's secret, the room admin's included", async () => {
  const roomAdmin = await signIn();
  const room = await newRoom(roomAdmin);
  const [mia, noah, tess] = [await member(room), await member(room), await member(room)];
  const adminsOwn = await write(roomAdmin, room, 'The room admin keeps a houseplant alive by lying to it');
  const sealed = await write(mia, room, 'Mia never submitted this one', { sealed: true });
  const matched = [await write(mia, room, 'An alpha secret of Mia'), await write(noah, room, 'An alpha secret of Noah')];
  const unmatched = await write(tess, room, 'Tess told nobody about the dent');

  const run = await roomAdmin.as('POST', `/api/secrets/group/${room.id}/compare`);
  assert.equal(run.status, 200);
  assert.equal(run.json.matches.length, 1);
  for (const { content } of [adminsOwn, sealed, ...matched, unmatched]) assert.ok(!run.body.includes(content), 'the run answered a secret');

  const miaWords = matched[0].content;
  const noahWords = matched[1].content;
  await sees(roomAdmin, room, [sealed.content, miaWords, noahWords, unmatched.content], 'the room admin');
  await sees(tess, room, [sealed.content, miaWords, noahWords, adminsOwn.content], 'a member outside the pair');
  await sees(noah, room, [sealed.content, unmatched.content, adminsOwn.content], 'the other half of the pair');
  await sees(mia, room, [unmatched.content, adminsOwn.content], 'one of the pair');
  await sees(bob, room, [sealed.content, miaWords, noahWords, unmatched.content, adminsOwn.content], 'a stranger');

  // The pair does read each other's, and only through the vault they matched in.
  const vault = (await noah.as('GET', `/api/secrets/group/${room.id}`)).json.matches;
  assert.equal(vault.length, 1);
  assert.ok([vault[0].obfuscated_a, vault[0].obfuscated_b].flat().includes(miaWords));
});

// Not pinned here, and open (docs/ROADMAP.md): a room admin's free-text rules are instructions to
// the AI, and the decoy count is theirs too. With a secret of their own submitted, a rule that says
// everything matches opens a vault on every submitted secret in the room. Closing it changes what
// rooms can do, so it stays Bennett's call.
