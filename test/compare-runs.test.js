// Comparison runs as a whole: each one is a string of AI calls on the room admin's key.
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

it('a second run in the same room while one is going gets a 409, not a repeat of every AI call', async () => {
  const admin = await app.guest();
  const group = (await admin.as('POST', '/api/groups', { name: 'Room' })).body.group;
  await admin.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-room-admin' });
  // Three members with unrelated secrets: three AI calls, half a second apart.
  for (const text of ['I hate cilantro', 'I cried at a car advert', 'I never learned to swim']) {
    const m = await app.guest();
    await m.as('POST', '/api/groups/join', { code: group.join_code });
    const id = (await m.as('POST', `/api/secrets/group/${group.id}`, { content: text })).body.secret.id;
    await m.as('PATCH', `/api/secrets/${id}/submit`);
  }
  const compare = () => admin.as('POST', `/api/secrets/group/${group.id}/compare`);

  app.openai.calls.length = 0;
  const runs = await Promise.all([compare(), compare()]);
  assert.deepEqual(runs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(app.openai.calls.length, 3);

  // Once it has finished, the room can run again.
  assert.equal((await compare()).status, 200);
});
