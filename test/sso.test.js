// Guests are refused. Waypoint's own sign-in page offers "Continue as guest" whatever an app
// wants, so the app answers 403 at the SSO callback (and at register and login, should Waypoint
// ever return a guest there) before a profile or a token is made, and has no guest route.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
const ADMIN_ID = 1000; // the stand-in Waypoint's first account, which the first test makes a guest
before(async () => { app = await startApp({ adminCentralUserIds: String(ADMIN_ID) }); });
after(async () => { await app?.stop(); });

const profiles = async () => (await app.db.query('SELECT COUNT(*)::int AS n FROM profiles')).rows[0].n;
const GUEST_MESSAGE = 'Guest accounts can’t be used here. Sign in with your own account.';
const post = (path, body, ip) => app.request('POST', path, { body, headers: { 'X-Forwarded-For': ip } });

describe('guests are refused', () => {
  it('at the SSO callback: 403 with the reason, no token, no profile, even for an id on the admin list', async () => {
    const before = await profiles();
    const guest = app.waypoint.guestAccount();
    assert.equal(guest.central_user_id, ADMIN_ID);
    const res = await post('/api/auth/sso-callback', { code: app.waypoint.issueCode(guest) }, '203.0.113.1');
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: GUEST_MESSAGE });

    const second = await post('/api/auth/sso-callback', { code: app.waypoint.issueCode(app.waypoint.guestAccount()) }, '203.0.113.1');
    assert.equal(second.status, 403);
    assert.equal(second.body.token, undefined);
    assert.equal(await profiles(), before);
  });

  it('a real account still signs in through the callback', async () => {
    const g = await app.user();
    assert.ok(g.token);
    assert.equal((await g.as('GET', '/api/auth/profile')).status, 200);
  });

  it('at register and login, if Waypoint returns a guest there', async () => {
    const before = await profiles();
    const reg = await post('/api/auth/register', { username: 'guest-quiet-fox', email: app.GUEST_EMAIL, password: 'pw' }, '203.0.113.2');
    assert.equal(reg.status, 403);
    assert.equal(reg.body.token, undefined);
    const login = await post('/api/auth/login', { email: app.GUEST_EMAIL, password: 'pw' }, '203.0.113.2');
    assert.equal(login.status, 403);
    assert.equal(login.body.token, undefined);
    assert.equal(await profiles(), before);
  });

  it('there is no guest route any more', async () => {
    const res = await post('/api/auth/guest', {}, '203.0.113.3');
    assert.equal(res.status, 404);
    assert.equal(res.body.token, undefined);
  });
});
