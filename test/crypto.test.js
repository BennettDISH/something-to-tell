// config/crypto.js on its own. It reads ENCRYPTION_KEY once, at import, so each key setup
// gets its own copy of the module (a query string makes a separate module instance).
import { it } from 'node:test';
import assert from 'node:assert/strict';

async function cryptoWithKey(key) {
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
  return import(`../config/crypto.js?key=${encodeURIComponent(key ?? '')}`);
}

// Written by the enc:v1 code under ENCRYPTION_KEY=golden-test-key. If this stops decrypting,
// every row already in the database stops decrypting too.
const OLD_ROW = 'enc:v1:Eu/ykpR8vDyX0g4yyGItLQ4HRemQEdekA1QT5dniAXZm7JAHmrc6J4hBo24o79SLH6sg8wWerpo9lDYG7oRWIfjKxlzf2g==';
const OLD_TEXT = 'written by the enc:v1 code of October 2026';

// Flip one bit of the stored bytes at `index` (0-11 iv, 12-27 auth tag, 28+ ciphertext).
function flip(value, index) {
  const buf = Buffer.from(value.slice('enc:v1:'.length), 'base64');
  buf[index] ^= 1;
  return 'enc:v1:' + buf.toString('base64');
}

it('rows already stored still decrypt', async () => {
  const c = await cryptoWithKey('golden-test-key');
  assert.deepEqual(c.tryDecrypt(OLD_ROW), { ok: true, value: OLD_TEXT });
});

it('uses a fresh IV per value, so equal secrets never look equal at rest', async () => {
  const c = await cryptoWithKey('golden-test-key');
  const [x, y] = [c.encrypt('same text'), c.encrypt('same text')];
  assert.notEqual(x, y);
  assert.notEqual(x.slice(7, 23), y.slice(7, 23), 'IVs differ');
  assert.equal(c.decrypt(x), 'same text');
  assert.equal(c.decrypt(y), 'same text');
  assert.equal(c.decrypt(c.encrypt('')), '');
});

it('rejects a changed IV, auth tag or ciphertext instead of returning altered text', async () => {
  const c = await cryptoWithKey('golden-test-key');
  for (const index of [0, 12, 27, 28, 40]) {
    assert.deepEqual(c.tryDecrypt(flip(OLD_ROW, index)), { ok: false, value: c.BAD_KEY_MARKER }, `byte ${index}`);
  }
});

it('a wrong key shows a marker, never garbage or a crash', async () => {
  const c = await cryptoWithKey('some-other-key');
  assert.deepEqual(c.tryDecrypt(OLD_ROW), { ok: false, value: c.BAD_KEY_MARKER });
  assert.deepEqual(c.decryptFields({ content: OLD_ROW, n: 1 }, ['content']), { content: c.BAD_KEY_MARKER, n: 1 });
});

it('with no key, stored ciphertext shows a marker and new values stay plaintext (as documented)', async () => {
  const c = await cryptoWithKey(undefined);
  assert.equal(c.encryptionEnabled, false);
  assert.deepEqual(c.tryDecrypt(OLD_ROW), { ok: false, value: c.NO_KEY_MARKER });
  assert.equal(c.encrypt('plain'), 'plain');
});
