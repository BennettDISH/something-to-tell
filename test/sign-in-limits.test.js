// Sign-in is limited per visitor before it reaches Waypoint, whose own caps count this
// server's one address for everybody. The stand-in Waypoint counts the calls that get through.
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

// trust proxy 1: the last X-Forwarded-For entry is the visitor's address.
const post = (path, ip, body) =>
  app.request('POST', path, { body, headers: { 'X-Forwarded-For': ip } });

it('ten password tries per address per 15 minutes, then 429 without asking Waypoint', async () => {
  const wrong = { email: 'mira@example.com', password: 'guess' };
  const seen = app.waypoint.calls.login;
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/auth/login', '203.0.113.5', wrong)).status, 400);
  assert.equal(app.waypoint.calls.login - seen, 10);

  const blocked = await post('/api/auth/login', '203.0.113.5', wrong);
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many sign-in attempts/);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // Even the right password is refused for now.
  const right = { email: 'mira@example.com', password: 'right-password' };
  assert.equal((await post('/api/auth/login', '203.0.113.5', right)).status, 429);
  assert.equal(app.waypoint.calls.login - seen, 10, 'the refused tries never reached Waypoint');

  // Someone else on another address still signs in normally.
  const ok = await post('/api/auth/login', '198.51.100.7', right);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.username, 'mira');
});

it('registering counts toward the same limit as logging in', async () => {
  const form = { username: 'x', email: 'x@example.com', password: 'pw' };
  const seen = app.waypoint.calls.register;
  for (let i = 0; i < 10; i++) assert.equal((await post('/api/auth/register', '203.0.113.40', form)).status, 400);
  assert.equal(app.waypoint.calls.register - seen, 10);

  const blocked = await post('/api/auth/register', '203.0.113.40', form);
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many sign-in attempts/);
  assert.equal(app.waypoint.calls.register - seen, 10, 'the refused try never reached Waypoint');
  // Sign-in and register share one count.
  assert.equal((await post('/api/auth/login', '203.0.113.40', { email: 'mira@example.com', password: 'right-password' })).status, 429);
  // Another address is unaffected.
  assert.equal((await post('/api/auth/register', '198.51.100.40', form)).status, 400);
});

it('the Waypoint return is limited too, with its own count', async () => {
  const exchange = (ip) => post('/api/auth/sso-callback', ip, { code: 'made-up' });
  const seen = app.waypoint.calls.token;
  for (let i = 0; i < 10; i++) assert.equal((await exchange('203.0.113.20')).status, 400);
  assert.equal(app.waypoint.calls.token - seen, 10);

  const blocked = await exchange('203.0.113.20');
  assert.equal(blocked.status, 429);
  assert.equal(app.waypoint.calls.token - seen, 10, 'the refused try never reached Waypoint');
  assert.equal((await exchange('198.51.100.20')).status, 400);
  // Password sign-in from the same address still has its own room.
  assert.equal((await post('/api/auth/login', '203.0.113.20', { email: 'mira@example.com', password: 'right-password' })).status, 200);
});
