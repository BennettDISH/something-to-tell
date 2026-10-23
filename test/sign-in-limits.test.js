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
