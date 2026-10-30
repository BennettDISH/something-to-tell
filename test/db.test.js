// The pg Pool and the schema initDb() builds, outside the running app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startPostgres } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run an ES module snippet in a fresh Node process from the repo root. */
function runModule(source, env = {}) {
  return new Promise((resolve, reject) => {
    // No DATABASE_URL unless given: the Pool only connects on its first query.
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, out }));
  });
}

test('an error on an idle database connection is logged and the process keeps running', async () => {
  // pg emits 'error' on the pool when an idle client's connection drops (a database restart,
  // a network blip). With no listener Node treats it as uncaught and the server exits.
  const { code, out } = await runModule(`
    import pool from './config/db.js';
    setTimeout(() => pool.emit('error', new Error('Connection terminated unexpectedly')));
    setTimeout(() => { console.log('still running'); process.exit(0); }, 200);
  `);
  assert.equal(code, 0, out);
  assert.match(out, /Postgres idle client error: Connection terminated unexpectedly/);
  assert.match(out, /still running/);
});

test('the tables read room by room are indexed on group_id, and a second boot is fine', async () => {
  const db = await startPostgres();
  try {
    const { code, out } = await runModule(`
      import { initDb } from './config/db.js';
      await initDb();
      await initDb();
      process.exit(0);
    `, { DATABASE_URL: db.url });
    assert.equal(code, 0, out);
    const { rows } = await db.query("SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'");
    for (const table of ['secrets', 'comparisons', 'vault_matches']) {
      assert.ok(rows.some((r) => r.tablename === table && /\(group_id\)$/.test(r.indexdef)), `${table} has no group_id index`);
    }
  } finally {
    await db.stop();
  }
});
