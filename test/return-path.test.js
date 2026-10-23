// After signing in the visitor goes back to the page they asked for (/admin), but only to a page of
// this app: never another site, never the sign-in pages themselves.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, takeSsoReturn } from '../src/services/authService.js';

describe('return path after sign-in', () => {
  it('keeps a page of this app', () => {
    assert.equal(safePath('/admin'), '/admin');
    assert.equal(safePath('/admin?group=3'), '/admin?group=3');
    assert.equal(safePath('/groups/7'), '/groups/7');
  });

  it('drops anything that could leave the app or loop through sign-in', () => {
    for (const bad of [undefined, null, '', 'admin', '//evil.example', '/\\evil.example', 'https://evil.example',
      'javascript:alert(1)', '/login', '/register', '/auth/callback']) {
      assert.equal(safePath(bad), '', String(bad));
    }
  });

  it('the Waypoint trip remembers the page once, and only a safe one', () => {
    const store = new Map([['sso_return', '/admin']]);
    globalThis.sessionStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    try {
      assert.equal(takeSsoReturn(), '/admin');
      assert.equal(takeSsoReturn(), '/'); // read once
      store.set('sso_return', '//evil.example');
      assert.equal(takeSsoReturn(), '/');
    } finally {
      delete globalThis.sessionStorage;
    }
  });
});
