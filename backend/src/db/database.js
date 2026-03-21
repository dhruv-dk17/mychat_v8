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
        username      VARCHAR(32) PRIMARY KEY,
        password_hash CHAR(64)    NOT NULL,
        token         VARCHAR(128),
        created_at    BIGINT      NOT NULL
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        slug             VARCHAR(8) PRIMARY KEY,
        password_hash    CHAR(64)   NOT NULL,
        owner_token_hash CHAR(64)   NOT NULL,
        owner_username   VARCHAR(32) REFERENCES users(username) ON DELETE CASCADE,
        created_at       BIGINT     NOT NULL
      )
    `);
    
    // Check if owner_username exists (for migration)
    const colCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='rooms' AND column_name='owner_username'
    `);
    if (colCheck.rows.length === 0) {
      await client.query(`ALTER TABLE rooms ADD COLUMN owner_username VARCHAR(32) REFERENCES users(username) ON DELETE CASCADE`);
    }

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_rooms_slug ON rooms(slug)`
    );
    console.log('✓ Database ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
