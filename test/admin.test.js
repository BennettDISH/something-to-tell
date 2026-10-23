// The site admin page (/admin): only ADMIN_CENTRAL_USER_IDS get its data, the page itself ships
// none, and a user's saved AI key never comes out of any admin route.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_ID = 1000; // the stand-in Waypoint's first account
const AI_KEY = 'sk-never-in-admin-1234567890';

let app;
let admin;
let member;
let group;

before(async () => {
  app = await startApp({ adminCentralUserIds: String(ADMIN_ID) });
  admin = await app.user();
  assert.equal(admin.user.central_user_id, ADMIN_ID);
  member = await app.user();
  group = (await member.as('POST', '/api/groups', { name: 'Vault' })).body.group;
  assert.equal((await member.as('PUT', '/api/ai/config', { provider: 'openai', api_key: AI_KEY })).status, 200);
  assert.equal((await member.as('POST', `/api/secrets/group/${group.id}`, { content: 'I hid the last biscuit' })).status, 201);
});
after(async () => { await app?.stop(); });

describe('admin gate', () => {
  it('the admin is flagged; a regular user is not', async () => {
    assert.equal((await admin.as('GET', '/api/auth/profile')).body.user.is_admin, true);
    assert.equal((await member.as('GET', '/api/auth/profile')).body.user.is_admin, false);
  });

  it('no token is 401, a signed-in non-admin is 403, on every admin route', async () => {
    for (const url of ['/api/admin/status', '/api/admin/groups', `/api/admin/groups/${group.id}`]) {
      assert.equal((await app.request('GET', url)).status, 401, url);
      assert.equal((await member.as('GET', url)).status, 403, url);
      assert.equal((await admin.as('GET', url)).status, 200, url);
    }
  });

  it('the old deep-intel route is gone: its content is on /admin', async () => {
    const old = await admin.as('GET', `/api/secrets/group/${group.id}/admin/logs`);
    assert.equal(old.body.logs, undefined); // the app shell answers an unknown page, not the old JSON
    assert.equal(old.body.allSecrets, undefined);
    const detail = await admin.as('GET', `/api/admin/groups/${group.id}`);
    assert.deepEqual(detail.body.secrets.map((s) => s.content), ['I hid the last biscuit']);
  });
});

describe('admin page', () => {
  it('/admin is the app shell for anyone: it carries no account or admin data', async () => {
    // The page is the React app; who may see what is decided by /api/admin/*, above. Needs a build.
    if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) return;
    for (const token of [undefined, member.token, admin.token]) {
      const res = await app.request('GET', '/admin', { token });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      for (const text of [member.user.username, 'I hid the last biscuit', group.join_code]) {
        assert.ok(!String(res.body).includes(text), text);
      }
    }
  });

  it('status: the app, its commit, the health check and the switch as on or off', async () => {
    const res = await admin.as('GET', '/api/admin/status');
    assert.equal(res.body.app, 'something-to-tell');
    assert.equal(res.body.health, 'ok');
    assert.deepEqual(res.body.switches, [{ name: 'Encryption at rest', on: true }]);
  });

  it('no admin answer carries anyone\'s AI key, plain or encrypted', async () => {
    const stored = (await app.db.query('SELECT api_key FROM ai_configs')).rows[0].api_key;
    assert.ok(stored.startsWith('enc:v1:'));
    for (const url of ['/api/admin/status', '/api/admin/groups', `/api/admin/groups/${group.id}`]) {
      const text = JSON.stringify((await admin.as('GET', url)).body);
      assert.ok(!text.includes(AI_KEY), url);
      assert.ok(!text.includes(stored), url);
      assert.ok(!text.includes('api_key'), url);
    }
  });
});
