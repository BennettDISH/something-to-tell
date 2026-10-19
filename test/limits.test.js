// Limits that keep one member from running up the room admin's AI bill: every submitted
// secret is sent to the AI once per other member's secret, on the room admin's key.
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

async function memberOfNewRoom() {
  const admin = await app.guest();
  const member = await app.guest();
  const group = (await admin.as('POST', '/api/groups', { name: 'Room' })).body.group;
  await member.as('POST', '/api/groups/join', { code: group.join_code });
  return { member, add: (content) => member.as('POST', `/api/secrets/group/${group.id}`, { content }) };
}

it('a secret must be non-empty text of at most 2000 characters', async () => {
  const { add } = await memberOfNewRoom();
  for (const content of [undefined, '', '   ', 42, { text: 'hi' }, 'x'.repeat(2001)]) {
    const res = await add(content);
    assert.equal(res.status, 400, `content ${JSON.stringify(content)?.slice(0, 20)} got ${res.status}`);
  }
  assert.equal((await add('x'.repeat(2000))).status, 201);
});

it('a member can have at most 10 secrets submitted in one room at a time', async () => {
  const { member, add } = await memberOfNewRoom();
  const ids = [];
  for (let i = 0; i < 11; i++) ids.push((await add(`secret number ${i}`)).body.secret.id);
  for (const id of ids.slice(0, 10)) assert.equal((await member.as('PATCH', `/api/secrets/${id}/submit`)).status, 200);

  const over = await member.as('PATCH', `/api/secrets/${ids[10]}/submit`);
  assert.equal(over.status, 400);
  assert.match(over.body.error, /10/);

  assert.equal((await member.as('PATCH', `/api/secrets/${ids[0]}/unsubmit`)).status, 200);
  assert.equal((await member.as('PATCH', `/api/secrets/${ids[10]}/submit`)).status, 200);
});
