import pg from 'pg';
import { encryptionEnabled, encrypt, isEncrypted } from './crypto.js';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      central_user_id INTEGER UNIQUE NOT NULL,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(255),
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Central accounts may have no email (the auth-service made it optional), so the local
    -- mirror must accept NULL. Widening only — safe to re-run on every boot.
    ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS ai_configs (
      id SERIAL PRIMARY KEY,
      central_user_id INTEGER NOT NULL REFERENCES profiles(central_user_id) ON DELETE CASCADE,
      provider VARCHAR(50) NOT NULL DEFAULT 'anthropic',
      api_key TEXT NOT NULL,
      model VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(central_user_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      join_code VARCHAR(20) UNIQUE NOT NULL,
      ai_prompt TEXT DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES profiles(central_user_id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    DO $$ BEGIN
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS ai_prompt TEXT DEFAULT '';
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS match_mode VARCHAR(50) DEFAULT 'semantic';
    EXCEPTION WHEN others THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS room_config JSONB DEFAULT '{}';
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      central_user_id INTEGER NOT NULL REFERENCES profiles(central_user_id),
      role VARCHAR(20) DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, central_user_id)
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      central_user_id INTEGER NOT NULL REFERENCES profiles(central_user_id),
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'sealed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vault_matches (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      secret_a_id INTEGER NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
      secret_b_id INTEGER NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
      ai_reasoning TEXT,
      obfuscated_a TEXT[] DEFAULT '{}',
      obfuscated_b TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(secret_a_id, secret_b_id)
    );

    CREATE TABLE IF NOT EXISTS comparisons (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      secret_a_id INTEGER NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
      secret_b_id INTEGER NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
      matched BOOLEAN NOT NULL DEFAULT FALSE,
      confidence NUMERIC(3,2),
      ai_reasoning TEXT,
      user_summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (encryptionEnabled) {
    await encryptExistingRows();
  } else {
    console.warn(
      '⚠ ENCRYPTION_KEY is not set — secrets and API keys are stored in PLAINTEXT. ' +
      'Set it to enable at-rest encryption; existing rows are encrypted automatically at next boot.'
    );
  }
}

// One-time (idempotent) backfill: encrypt any plaintext rows left from before
// encryption was enabled. Idempotency lives HERE, not in encrypt() — already-
// ciphertext values are skipped via isEncrypted(), so a user secret that merely
// starts with 'enc:v1:' still gets encrypted like any other plaintext.
// Data volumes are small, so row-at-a-time is fine.
const encryptIfNeeded = (v) => (isEncrypted(v) ? v : encrypt(v));

async function encryptExistingRows() {
  // Advisory lock: two Railway replicas booting together must not both rewrite
  // rows (a concurrent user write could otherwise be read stale and reverted).
  // try_ = non-blocking; the loser simply skips, the winner does the work.
  const { rows: [lock] } = await pool.query('SELECT pg_try_advisory_lock(8724531) AS got');
  if (!lock.got) {
    console.log('[crypto] backfill already running on another instance — skipping');
    return;
  }
  try {
    const tables = [
      { table: 'secrets', cols: ['content'] },
      { table: 'ai_configs', cols: ['api_key'] },
      { table: 'vault_matches', cols: ['ai_reasoning', 'obfuscated_a', 'obfuscated_b'] },
      { table: 'comparisons', cols: ['ai_reasoning', 'user_summary'] },
    ];
    for (const { table, cols } of tables) {
      const { rows } = await pool.query(`SELECT id, ${cols.join(', ')} FROM ${table}`);
      let updated = 0;
      for (const row of rows) {
        const patch = {};
        for (const col of cols) {
          const v = row[col];
          const encd = Array.isArray(v) ? v.map(encryptIfNeeded) : encryptIfNeeded(v);
          if (JSON.stringify(encd) !== JSON.stringify(v)) patch[col] = encd;
        }
        const keys = Object.keys(patch);
        if (!keys.length) continue;
        // Guard the write with the value we read: if a user changed the row
        // mid-backfill, their newer (already encrypted) value wins.
        const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        const wheres = keys.map((k, i) => `${k} IS NOT DISTINCT FROM $${keys.length + i + 2}`).join(' AND ');
        const { rowCount } = await pool.query(
          `UPDATE ${table} SET ${sets} WHERE id = $1 AND ${wheres}`,
          [row.id, ...keys.map((k) => patch[k]), ...keys.map((k) => row[k])],
        );
        if (rowCount) updated++;
      }
      if (updated) console.log(`[crypto] encrypted ${updated} pre-existing row(s) in ${table}`);
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock(8724531)');
  }
}

export default pool;
