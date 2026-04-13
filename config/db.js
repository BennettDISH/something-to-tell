import pg from 'pg';
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
      email VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

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
      obfuscation_level INTEGER DEFAULT 3,
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
}

export default pool;
