// The shared hardening: a Content-Security-Policy, JSON answers under /api, a 500 that says nothing
// about what broke, and a request log with nothing secret in it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const WIDGET = 'https://bug-tracker-production-4ccb.up.railway.app';

let app;
before(async () => { app = await startApp(); });
after(async () => { await app?.stop(); });

function policy(res) {
  const header = res.headers.get('content-security-policy');
  assert.ok(header, 'no Content-Security-Policy');
  return Object.fromEntries(header.split(';').map((d) => d.trim().split(/\s+/)).filter(([n]) => n).map(([n, ...v]) => [n, v]));
}

describe('headers', () => {
  it('the API and the health check send a policy that runs only the site\'s scripts, the widget and the fonts', async () => {
    for (const url of ['/health', '/api/auth/config', '/api/nope']) {
      const res = await fetch(`${app.base}${url}`);
      const csp = policy(res);
      assert.deepEqual(csp['default-src'], ["'self'"], url);
      assert.deepEqual(csp['script-src'], ["'self'", WIDGET], url);
      assert.deepEqual(csp['connect-src'], ["'self'", WIDGET], url);
      assert.deepEqual(csp['script-src-attr'], ["'none'"], url);
      assert.deepEqual(csp['object-src'], ["'none'"], url);
      assert.deepEqual(csp['frame-ancestors'], ["'self'"], url);
      assert.deepEqual(csp['font-src'], ["'self'", 'https://fonts.gstatic.com'], url);
      assert.ok(csp['style-src'].includes('https://fonts.googleapis.com') && csp['style-src'].includes("'unsafe-inline'"), url);
      assert.ok(csp['img-src'].includes('blob:') && csp['img-src'].includes('data:'), `${url}: the widget resizes a screenshot through a blob: image`);
      assert.equal(csp['upgrade-insecure-requests'], undefined, url);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
    }
  });
});

describe('JSON answers under /api', () => {
  it('an unknown /api path is a JSON 404 for every method', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${app.base}/api/nope`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      assert.equal(res.status, 404, method);
      assert.match(res.headers.get('content-type'), /json/, method);
      assert.deepEqual(await res.json(), { error: 'Not found' }, method);
    }
  });

  it('a body that is not JSON is a 400, and one over the limit a 413, both in JSON', async () => {
    const broken = await fetch(`${app.base}/api/auth/sso-callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    assert.equal(broken.status, 400);
    assert.deepEqual(await broken.json(), { error: 'That request was not valid JSON' });
    const huge = await fetch(`${app.base}/api/auth/sso-callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(300 * 1024) }),
    });
    assert.equal(huge.status, 413);
    assert.deepEqual(await huge.json(), { error: 'That request is too large' });
  });
});

describe('a failure on our side', () => {
  it('answers "Something went wrong" and logs the real error with the request id', async () => {
    const own = await startApp(); // its own database, because this test breaks it
    try {
      const user = await own.user();
      assert.equal((await user.as('GET', '/api/groups')).status, 200);
      await own.db.query('DROP TABLE group_members CASCADE'); // what the next query needs is gone
      const res = await fetch(`${own.base}/api/groups`, { headers: { Authorization: `Bearer ${user.token}`, 'X-Request-Id': 'trace-me-0081' } });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: 'Something went wrong' });
      await new Promise((r) => setTimeout(r, 100));
      const log = own.log();
      assert.match(log, /trace-me-0081 GET \/api\/groups 500 \d+ms/, 'the request line');
      assert.match(log, /trace-me-0081 GET \/api\/groups .*\n?.*group_members/s, 'the real error, with the same id, is in the log');
    } finally {
      await own.stop();
    }
  });
});

describe('the request log', () => {
  it('has an id, method, path and status, never a query string; the healthcheck is not logged', async () => {
    const res = await fetch(`${app.base}/api/auth/sso/login?state=secret-state-123`, { redirect: 'manual', headers: { 'X-Request-Id': 'trace-me-0082' } });
    assert.equal(res.headers.get('x-request-id'), 'trace-me-0082');
    await fetch(`${app.base}/health`);
    await fetch(`${app.base}/api/groups/0123456789abcdef0123456789`); // 401: no token
    await new Promise((r) => setTimeout(r, 100));
    const log = app.log();
    assert.match(log, /trace-me-0082 GET \/api\/auth\/sso\/login \d{3} \d+ms/);
    assert.match(log, /GET \/api\/groups\/:token 401 \d+ms/);
    assert.doesNotMatch(log, /secret-state-123|state=/);
    assert.doesNotMatch(log, /GET \/health /);
  });
});
