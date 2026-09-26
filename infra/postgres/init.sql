-- Fresh-volume seed for local compose postgres.
-- The blog also self-ensures this schema on boot (apps/blog/src/db.js),
-- so this file only matters for brand-new volumes.
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO posts (title, body)
SELECT 'Hello from 3AM', 'First post on the demo blog.'
WHERE NOT EXISTS (SELECT 1 FROM posts);
