const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id               SERIAL PRIMARY KEY,
        username         VARCHAR(32) UNIQUE NOT NULL,
        password_hash    TEXT NOT NULL,
        recovery_key_hash TEXT NOT NULL,
        public_identity_key TEXT,
        session_token    VARCHAR(128),
        contacts         JSONB DEFAULT '[]'::jsonb,
        last_active      TIMESTAMP DEFAULT NOW(),
        created_at       TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id      SERIAL PRIMARY KEY,
        room_name    VARCHAR(64) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        owner_username VARCHAR(32) REFERENCES users(username) ON DELETE CASCADE,
        expires_at   TIMESTAMP,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dead_drops (
        id                SERIAL PRIMARY KEY,
        receiver_username VARCHAR(32) NOT NULL,
        encrypted_payload TEXT NOT NULL,
        sender_public_key TEXT NOT NULL,
        expires_at        TIMESTAMP NOT NULL,
        delivered         BOOLEAN DEFAULT FALSE,
        created_at        TIMESTAMP DEFAULT NOW()
      )
    `);

    // We can drop the old tables later if it's safe and this is a completely new DB instance.
    // However, the instructions state "Use a separate database instance for v8 — do NOT touch the v7 database"
    // so we don't strictly need to DROP.

    console.log('✓ Database ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
