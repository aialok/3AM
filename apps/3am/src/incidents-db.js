import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.THREE_AM_DATABASE_URL;
// Fail fast: without this, pg silently falls back to localhost:5432 and the
// connection error points at the wrong host.
if (!connectionString) {
  throw new Error('THREE_AM_DATABASE_URL is not set — check .env at the repo root');
}

// 3AM incidents database (Neon) - separate from blog and TrueForge
export const incidentsPool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Initialize schema on startup
export async function initIncidentsSchema() {
  // ID source lives in the DB so a process restart can't reuse a number.
  await incidentsPool.query(`CREATE SEQUENCE IF NOT EXISTS incident_id_seq START 1`);

  await incidentsPool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      alertname TEXT NOT NULL,
      service TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      session_id TEXT,
      rca JSONB,
      error TEXT,
      alert_count INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_alert_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ,
      starts_at TIMESTAMPTZ,
      labels JSONB DEFAULT '{}',
      timeline JSONB DEFAULT '[]'
    );
  `);

  await incidentsPool.query(`
    CREATE INDEX IF NOT EXISTS idx_incidents_key ON incidents (alertname, service);
  `);

  await incidentsPool.query(`
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
  `);
}

// Next incident id as INC-0001, INC-0002, ... allocated by Postgres.
export async function nextIncidentId() {
  const { rows } = await incidentsPool.query(`SELECT nextval('incident_id_seq') AS n`);
  return `INC-${String(rows[0].n).padStart(4, '0')}`;
}