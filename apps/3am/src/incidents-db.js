import pg from 'pg';

const { Pool } = pg;

// 3AM incidents database (Neon) - separate from blog and TrueForge
export const incidentsPool = new Pool({
  connectionString: process.env.THREE_AM_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Initialize schema on startup
export async function initIncidentsSchema() {
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