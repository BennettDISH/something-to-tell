// What happens when ENCRYPTION_KEY is missing or wrong. In production a missing key must
// not mean plaintext: storing secrets, AI keys and comparison text is refused. And a key
// that cannot read the rows already stored is called out loudly at boot.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startPostgres } from './helpers.js';

it('in production with no ENCRYPTION_KEY, saving secrets, AI keys and comparisons is refused', async () => {
  const db = await startPostgres();
  // Production turns on SSL for Postgres; the in-memory one speaks plain TCP.
  const app = await startApp({ db, env: { NODE_ENV: 'production', ENCRYPTION_KEY: '', DATABASE_URL: `${db.url}?sslmode=disable` } });
  try {
    const g = await app.user();
    const group = (await g.as('POST', '/api/groups', { name: 'Room' })).body.group;

    assert.equal((await g.as('POST', `/api/secrets/group/${group.id}`, { content: 'my real secret' })).status, 503);
    assert.equal((await g.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-real-key' })).status, 503);
    assert.equal((await g.as('POST', `/api/secrets/group/${group.id}/compare`)).status, 503);
    assert.equal((await g.as('GET', `/api/secrets/group/${group.id}`)).status, 200, 'reads still work');

    assert.equal((await db.query('SELECT 1 FROM secrets')).rows.length, 0);
    assert.equal((await db.query('SELECT 1 FROM ai_configs')).rows.length, 0);
    assert.match(app.log(), /ENCRYPTION_KEY is not set — saving secrets and AI keys is refused/);
  } finally {
    await app.stop();
    await db.stop();
  }
});

it('outside production, no ENCRYPTION_KEY still stores plaintext (local development)', async () => {
  const app = await startApp({ env: { ENCRYPTION_KEY: '' } });
  try {
    const g = await app.user();
    const group = (await g.as('POST', '/api/groups', { name: 'Room' })).body.group;
    assert.equal((await g.as('POST', `/api/secrets/group/${group.id}`, { content: 'dev secret' })).status, 201);
  } finally {
    await app.stop();
  }
});

it('warns at boot when stored rows cannot be decrypted with the current key, and never logs their content', async () => {
  const db = await startPostgres();
  try {
    let app = await startApp({ db, env: { ENCRYPTION_KEY: 'first-key' } });
    const g = await app.user();
    const group = (await g.as('POST', '/api/groups', { name: 'Room' })).body.group;
    assert.equal((await g.as('POST', `/api/secrets/group/${group.id}`, { content: 'the stored secret' })).status, 201);
    await g.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-stored-key' });
    await app.stop();

    app = await startApp({ db, env: { ENCRYPTION_KEY: 'second-key' } });
    await app.stop();
    let log = app.log();
    assert.match(log, /ENCRYPTION_KEY cannot decrypt 2 stored value\(s\)/);
    assert.ok(!log.includes('the stored secret') && !log.includes('sk-stored-key'));

    app = await startApp({ db, env: { ENCRYPTION_KEY: '' } });
    await app.stop();
    log = app.log();
    assert.match(log, /2 stored value\(s\) are encrypted but ENCRYPTION_KEY is not set/);

    // The right key again: nothing to warn about.
    app = await startApp({ db, env: { ENCRYPTION_KEY: 'first-key' } });
    await app.stop();
    log = app.log();
    assert.doesNotMatch(log, /cannot decrypt|cannot be read/);
  } finally {
    await db.stop();
  }
});
