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
  // Headroom above the default 10: during the db-lock scenario every read
  // parks on the advisory lock, and a starved pool takes down the whole app
  // (including /chaos/stop). Extra capacity keeps the control plane alive.
  max: Number(process.env.PG_POOL_MAX ?? 20),
  // Gives up on acquiring a connection rather than queueing forever. This is
  // what turns pool starvation into a real 500 in Sentry instead of a silent
  // hang — the evidence the investigator needs to call it a DB incident.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 2500),
});

// A dropped Neon/idle connection surfaces here. Without a listener pg emits
// an unhandled 'error' event and kills the process mid-demo.
pool.on('error', (err) => console.error('[blog] idle client error:', err.message));

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
