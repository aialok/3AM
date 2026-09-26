import pg from 'pg';

const { Pool } = pg;

// DATABASE_URL comes from env (.env local, .env.staging Neon).
// Neon needs TLS; local postgres does not — decided from the URL, not code.
function sslFor(url) {
  if (process.env.PGSSL === 'true') return { rejectUnauthorized: false };
  if (url.includes('neon.tech')) return { rejectUnauthorized: false };
  return undefined;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL ?? ''),
});

// Self-ensures schema so the app boots against any empty DB
// (local compose postgres or staging Neon). init.sql covers fresh
// compose volumes; this covers everything else.
export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM posts');
  if (rows[0].n === 0) {
    await pool.query(
      `INSERT INTO posts (title, body) VALUES
        ('Hello from 3AM', 'First post on the demo blog.'),
        ('Why we watch p95', 'Latency spikes are the canary for incidents.'),
        ('Postgres locks, explained', 'Advisory locks and pool exhaustion demo seed.')`
    );
    console.log('[blog] seeded posts');
  }
}
