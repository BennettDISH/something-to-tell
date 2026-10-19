// The boot-time backfill in config/db.js: rows written while ENCRYPTION_KEY was unset are
// encrypted at the next boot and still read back as the original text.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startPostgres } from './helpers.js';

const isCiphertext = (v) => typeof v === 'string' && v.startsWith('enc:v1:');

it('encrypts plaintext rows left from before the key was set, and keeps them readable', async () => {
  const db = await startPostgres();
  try {
    let app = await startApp({ db });
    const g = await app.guest();
    const group = (await g.as('POST', '/api/groups', { name: 'Old room' })).body.group;
    await app.stop();

    // Written straight to the database, the way rows looked before encryption existed.
    // The last one only looks like ciphertext: it is a user's text that starts with the prefix.
    const plain = ['written before the key was set', 'enc:v1:not really ciphertext'];
    for (const content of plain) {
      await db.query('INSERT INTO secrets (group_id, central_user_id, content) VALUES ($1, $2, $3)', [group.id, g.user.central_user_id, content]);
    }
    await db.query("INSERT INTO ai_configs (central_user_id, provider, api_key) VALUES ($1, 'openai', 'sk-plain-old-key')", [g.user.central_user_id]);

    app = await startApp({ db });
    try {
      const { rows: secrets } = await db.query('SELECT content FROM secrets WHERE group_id = $1', [group.id]);
      assert.equal(secrets.length, 2);
      assert.ok(secrets.every((r) => isCiphertext(r.content) && !r.content.includes('before the key') && !r.content.includes('not really')));
      const { rows: [config] } = await db.query('SELECT api_key FROM ai_configs WHERE central_user_id = $1', [g.user.central_user_id]);
      assert.ok(isCiphertext(config.api_key) && !config.api_key.includes('sk-plain'));

      // Same user, same token, now talking to the rebooted server.
      const view = await app.request('GET', `/api/secrets/group/${group.id}`, { token: g.token });
      assert.deepEqual(view.body.secrets.map((s) => s.content).sort(), [...plain].sort());

      // A third boot leaves already-encrypted rows alone.
      const before = (await db.query('SELECT content FROM secrets WHERE group_id = $1 ORDER BY id', [group.id])).rows.map((r) => r.content);
      await app.stop();
      app = await startApp({ db });
      const after = (await db.query('SELECT content FROM secrets WHERE group_id = $1 ORDER BY id', [group.id])).rows.map((r) => r.content);
      assert.deepEqual(after, before);
    } finally {
      await app.stop();
    }
  } finally {
    await db.stop();
  }
});
