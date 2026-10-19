// API tests against the real server, a real (in-memory) Postgres and stand-ins for Waypoint
// and OpenAI. They pin down how the riskiest routes behave today: sign-in, group
// membership and roles, secrets and AI keys encrypted at rest, and what an opened vault
// sends to its two members.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startApp } from './helpers.js';

const isCiphertext = (v) => typeof v === 'string' && v.startsWith('enc:v1:');

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

// A group made by `admin`, joined by everyone in `members`.
async function makeGroup(admin, members = [], extra = {}) {
  const created = await admin.as('POST', '/api/groups', { name: 'Vault', description: 'test', ...extra });
  assert.equal(created.status, 201);
  const group = created.body.group;
  for (const m of members) assert.equal((await m.as('POST', '/api/groups/join', { code: group.join_code })).status, 201);
  return group;
}

describe('auth', () => {
  it('rejects requests with no token or a forged one', async () => {
    for (const url of ['/api/groups', '/api/ai/config', '/api/secrets/group/1', '/api/auth/profile']) {
      assert.equal((await app.request('GET', url)).status, 401, url);
    }
    const forged = jwt.sign({ central_user_id: 1000 }, 'not-the-secret');
    assert.equal((await app.request('GET', '/api/groups', { token: forged })).status, 401);
  });

  it('guest sign-in creates a profile that is not a site admin', async () => {
    const g = await app.guest();
    const profile = await g.as('GET', '/api/auth/profile');
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.central_user_id, g.user.central_user_id);
    assert.equal(profile.body.user.is_admin, false);
    assert.equal((await g.as('GET', '/api/admin/groups')).status, 403);
  });
});

describe('groups', () => {
  it('the creator is the room admin; members can read but not change or delete it', async () => {
    const admin = await app.guest();
    const member = await app.guest();
    const outsider = await app.guest();
    const group = await makeGroup(admin, [member]);

    const view = await member.as('GET', `/api/groups/${group.id}`);
    assert.equal(view.status, 200);
    assert.deepEqual(view.body.group.members.map((m) => m.role), ['admin', 'member']);

    assert.equal((await outsider.as('GET', `/api/groups/${group.id}`)).status, 403);
    assert.equal((await member.as('PUT', `/api/groups/${group.id}`, { name: 'Hijacked' })).status, 403);
    assert.equal((await member.as('DELETE', `/api/groups/${group.id}`)).status, 403);
    assert.equal((await outsider.as('POST', '/api/groups/join', { code: 'nope' })).status, 404);

    const updated = await admin.as('PUT', `/api/groups/${group.id}`, { room_config: { deniability: 3 } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.group.room_config.deniability, 3);
    assert.equal(updated.body.group.name, 'Vault', 'fields not sent stay as they were');

    const again = await member.as('POST', '/api/groups/join', { code: group.join_code });
    assert.equal(again.body.message, 'Already a member');
  });

  it('new rooms get 16-character join codes, and old 8-character codes still work', async () => {
    const admin = await app.guest();
    const group = await makeGroup(admin);
    assert.match(group.join_code, /^[0-9a-f]{16}$/);

    const { rows: [old] } = await app.db.query(
      "INSERT INTO groups (name, join_code, created_by) VALUES ('Old room', '0a1b2c3d', $1) RETURNING id",
      [admin.user.central_user_id],
    );
    const member = await app.guest();
    const joined = await member.as('POST', '/api/groups/join', { code: '0a1b2c3d' });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.group.id, old.id);
  });

  it('a client that keeps guessing join codes is shut out, whatever account it uses, without locking out others', async () => {
    const group = await makeGroup(await app.guest());
    // The app trusts one proxy hop, as on Railway, so each forwarded address is its own client.
    const join = async (ip, code) => {
      const g = await app.guest();
      return app.request('POST', '/api/groups/join', { token: g.token, body: { code }, headers: { 'X-Forwarded-For': ip } });
    };

    for (let i = 0; i < 10; i++) assert.equal((await join('203.0.113.7', `wrong${i}`)).status, 404, `guess ${i}`);
    assert.equal((await join('203.0.113.7', 'wrong10')).status, 429);
    assert.equal((await join('203.0.113.7', group.join_code)).status, 429, 'a right code is refused too once over the limit');

    assert.equal((await join('203.0.113.8', group.join_code)).status, 201);
  });
});

describe('secrets', () => {
  it('are stored encrypted, read back decrypted, and only by their owner', async () => {
    const admin = await app.guest();
    const member = await app.guest();
    const outsider = await app.guest();
    const group = await makeGroup(admin, [member]);
    const text = 'I have never seen the ocean';

    assert.equal((await outsider.as('POST', `/api/secrets/group/${group.id}`, { content: text })).status, 403);
    const created = await member.as('POST', `/api/secrets/group/${group.id}`, { content: text });
    assert.equal(created.status, 201);
    assert.equal(created.body.secret.content, text);
    assert.equal(created.body.secret.status, 'sealed');

    const { rows: [row] } = await app.db.query('SELECT content FROM secrets WHERE id = $1', [created.body.secret.id]);
    assert.ok(isCiphertext(row.content), 'stored as enc:v1: ciphertext');
    assert.ok(!row.content.includes('ocean'));

    const mine = await member.as('GET', `/api/secrets/group/${group.id}`);
    assert.deepEqual(mine.body.secrets.map((s) => s.content), [text]);

    const theirs = await admin.as('GET', `/api/secrets/group/${group.id}`);
    assert.deepEqual(theirs.body.secrets, [], "the admin can't read a member's secret");
    assert.ok(!JSON.stringify(theirs.body).includes('ocean'));
    assert.deepEqual(theirs.body.otherMembers.map((m) => Number(m.total_count)), [1]);

    assert.equal((await outsider.as('GET', `/api/secrets/group/${group.id}`)).status, 403);
  });

  it('submit, unsubmit and delete only work on your own secret', async () => {
    const admin = await app.guest();
    const member = await app.guest();
    const group = await makeGroup(admin, [member]);
    const id = (await member.as('POST', `/api/secrets/group/${group.id}`, { content: 'a small secret' })).body.secret.id;

    assert.equal((await admin.as('PATCH', `/api/secrets/${id}/submit`)).status, 404);
    assert.equal((await member.as('PATCH', `/api/secrets/${id}/unsubmit`)).status, 400);
    const submitted = await member.as('PATCH', `/api/secrets/${id}/submit`);
    assert.equal(submitted.body.secret.status, 'submitted');
    assert.equal(submitted.body.secret.content, 'a small secret');
    assert.equal((await member.as('PATCH', `/api/secrets/${id}/submit`)).status, 400);
    assert.equal((await member.as('PATCH', `/api/secrets/${id}/unsubmit`)).body.secret.status, 'sealed');

    assert.equal((await admin.as('DELETE', `/api/secrets/${id}`)).status, 404);
    assert.equal((await member.as('DELETE', `/api/secrets/${id}`)).status, 200);
    assert.equal((await member.as('DELETE', `/api/secrets/${id}`)).status, 404);
  });
});

describe('AI config', () => {
  it('stores the API key encrypted and never sends it back', async () => {
    const g = await app.guest();
    assert.equal((await g.as('PUT', '/api/ai/config', { provider: 'openai' })).status, 400);
    assert.equal((await g.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-test-123', model: 'gpt-test' })).status, 200);

    const { rows: [row] } = await app.db.query('SELECT api_key FROM ai_configs WHERE central_user_id = $1', [g.user.central_user_id]);
    assert.ok(isCiphertext(row.api_key));
    assert.ok(!row.api_key.includes('sk-test-123'));

    const config = await g.as('GET', '/api/ai/config');
    assert.equal(config.body.config.provider, 'openai');
    assert.ok(!('api_key' in config.body.config));
  });
});

describe('comparison and opened vaults', () => {
  it('only the room admin can run it, and it needs an AI key and two submitted secrets', async () => {
    const admin = await app.guest();
    const member = await app.guest();
    const group = await makeGroup(admin, [member]);
    const url = `/api/secrets/group/${group.id}/compare`;

    assert.equal((await member.as('POST', url)).status, 403);
    assert.equal((await admin.as('POST', url)).status, 400, 'no AI provider yet');
    await admin.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-admin-key' });
    const tooFew = await admin.as('POST', url);
    assert.equal(tooFew.status, 400);
    assert.match(tooFew.body.error, /at least 2/);
  });

  it('a match opens a vault for its two members, encrypted at rest and padded with decoys', async () => {
    const admin = await app.guest();
    const ann = await app.guest();
    const bob = await app.guest();
    const cat = await app.guest();
    const group = await makeGroup(admin, [ann, bob, cat], {});
    await admin.as('PUT', `/api/groups/${group.id}`, { room_config: { deniability: 2 } });
    await admin.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-room-admin', model: 'gpt-test' });

    const annSecret = 'I adopted an alpha wolf pup last spring';
    const bobSecret = 'There is an alpha wolf living in my garage';
    const catSecret = 'I failed my driving test four times';
    for (const [who, text] of [[ann, annSecret], [bob, bobSecret], [cat, catSecret]]) {
      const id = (await who.as('POST', `/api/secrets/group/${group.id}`, { content: text })).body.secret.id;
      await who.as('PATCH', `/api/secrets/${id}/submit`);
    }

    app.openai.calls.length = 0;
    const run = await admin.as('POST', `/api/secrets/group/${group.id}/compare`);
    assert.equal(run.status, 200);
    assert.equal(run.body.compared, 3);
    assert.equal(run.body.matches.length, 1);
    assert.equal(run.body.results.length, 3);
    assert.ok(app.openai.calls.length >= 3);
    assert.ok(app.openai.calls.every((c) => c.authorization === 'Bearer sk-room-admin'), "the room admin's decrypted key is used");
    assert.equal(app.openai.calls.filter((c) => c.kind === 'decoys').length, 2);

    // At rest: reasoning and both decoy lists are ciphertext, element by element.
    const { rows: [vault] } = await app.db.query('SELECT ai_reasoning, obfuscated_a, obfuscated_b FROM vault_matches WHERE group_id = $1', [group.id]);
    assert.ok(isCiphertext(vault.ai_reasoning));
    for (const list of [vault.obfuscated_a, vault.obfuscated_b]) {
      assert.equal(list.length, 3);
      assert.ok(list.every(isCiphertext));
    }
    const { rows: statuses } = await app.db.query("SELECT COUNT(*)::int AS n FROM secrets WHERE group_id = $1 AND status = 'matched'", [group.id]);
    assert.equal(statuses[0].n, 2);

    // Ann and Bob each see the vault, decrypted, with each real secret among two decoys.
    for (const who of [ann, bob]) {
      const view = await who.as('GET', `/api/secrets/group/${group.id}`);
      assert.equal(view.body.matches.length, 1);
      const m = view.body.matches[0];
      const sides = [m.obfuscated_a, m.obfuscated_b];
      assert.ok(sides.every((s) => Array.isArray(s) && s.length === 3 && !s.some(isCiphertext)));
      assert.ok(sides.some((s) => s.includes(annSecret)));
      assert.ok(sides.some((s) => s.includes(bobSecret)));
      assert.ok(sides.every((s) => s.includes('I once ate a whole cake alone')));
      // The AI's reasoning quotes both real secrets, which would point straight past the
      // decoys, so a vault with decoys shows the scrubbed summary instead.
      assert.equal(m.ai_reasoning, 'You both shared something about pets.');
      assert.ok(!m.ai_reasoning.includes(annSecret) && !m.ai_reasoning.includes(bobSecret));
      assert.deepEqual([m.user_a_name, m.user_b_name].sort(), [ann.user.username, bob.user.username].sort());
    }

    // Cat isn't in the vault and sees only the comparisons involving her own secret.
    const catView = await cat.as('GET', `/api/secrets/group/${group.id}`);
    assert.deepEqual(catView.body.matches, []);
    assert.equal(catView.body.comparisons.length, 2);
    assert.ok(catView.body.comparisons.every((c) => c.matched === false && !isCiphertext(c.user_summary)));
    assert.ok(!JSON.stringify(catView.body).includes('wolf'));

    // A matched secret can't be deleted, and leaves the pool: a second run has only Cat's
    // secret left, so it refuses and no second vault appears.
    const annMatched = (await ann.as('GET', `/api/secrets/group/${group.id}`)).body.secrets[0];
    assert.equal(annMatched.status, 'matched');
    assert.equal((await ann.as('DELETE', `/api/secrets/${annMatched.id}`)).status, 400);
    assert.equal((await admin.as('POST', `/api/secrets/group/${group.id}/compare`)).status, 400);
    const { rows: [{ n }] } = await app.db.query('SELECT COUNT(*)::int AS n FROM vault_matches WHERE group_id = $1', [group.id]);
    assert.equal(n, 1);
  });
});
