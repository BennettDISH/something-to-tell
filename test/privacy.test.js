// What each member can learn about other members' secrets: what a comparison run, an
// opened vault and a room someone has left send back. Same kit as api.test.js.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

// A room whose admin has an AI key and the given number of decoys. Each text becomes one
// new member's submitted secret. The admin submits nothing.
async function room(deniability, texts) {
  const admin = await app.guest();
  const group = (await admin.as('POST', '/api/groups', { name: 'Room' })).body.group;
  await admin.as('PUT', `/api/groups/${group.id}`, { room_config: { deniability } });
  await admin.as('PUT', '/api/ai/config', { provider: 'openai', api_key: 'sk-room-admin' });
  const members = [];
  for (const text of texts) {
    const m = await app.guest();
    assert.equal((await m.as('POST', '/api/groups/join', { code: group.join_code })).status, 201);
    const id = (await m.as('POST', `/api/secrets/group/${group.id}`, { content: text })).body.secret.id;
    assert.equal((await m.as('PATCH', `/api/secrets/${id}/submit`)).status, 200);
    members.push(m);
  }
  return {
    admin,
    group,
    members,
    compare: () => admin.as('POST', `/api/secrets/group/${group.id}/compare`),
    view: (who) => who.as('GET', `/api/secrets/group/${group.id}`),
  };
}

describe('comparison runs', () => {
  it("the run's response doesn't hand the room admin other members' secrets", async () => {
    const texts = ['My alpha secret is that I cheated on the bar exam', 'An alpha confession: I read my sister\'s diary'];
    const r = await room(2, texts);
    const run = await r.compare();
    assert.equal(run.status, 200);
    assert.equal(run.body.matches.length, 1, 'the UI still gets a match count');
    const body = JSON.stringify(run.body);
    for (const t of texts) assert.ok(!body.includes(t), `"${t}" is in the room admin's response`);
  });
});

describe('leaving a room', () => {
  it("takes the leaver's secrets out of later comparisons and the room's submitted count", async () => {
    const leaverText = 'My alpha dog ran away and I never told anyone';
    const r = await room(0, [leaverText, 'My alpha parrot swears at guests', 'I hate cilantro']);
    const [leaver, stayer] = r.members;
    assert.equal((await leaver.as('DELETE', `/api/groups/${r.group.id}/leave`)).status, 200);

    assert.equal(Number((await r.view(r.admin)).body.submittedStats.submitted_count), 2);
    const run = await r.compare();
    assert.equal(run.status, 200);
    assert.equal(run.body.compared, 2);
    assert.equal(run.body.matches.length, 0);

    const view = await r.view(stayer);
    assert.deepEqual(view.body.matches, []);
    assert.ok(!JSON.stringify(view.body).includes(leaverText));
  });
});

describe('opened vaults', () => {
  it('a vault without decoys still shows the full reasoning, since both secrets are shown anyway', async () => {
    const texts = ['I named my goldfish alpha', 'My alpha cat bites everyone'];
    const r = await room(0, texts);
    assert.equal((await r.compare()).status, 200);
    for (const who of r.members) {
      const [m] = (await r.view(who)).body.matches;
      assert.deepEqual([m.obfuscated_a, m.obfuscated_b].flat().sort(), [...texts].sort());
      assert.match(m.ai_reasoning, /^Both are about the same pet/);
      assert.ok(texts.every((t) => m.ai_reasoning.includes(t)));
    }
  });
});
