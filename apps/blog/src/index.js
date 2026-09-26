import './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { pool, ensureSchema } from './db.js';
import { metricsMiddleware, register } from './metrics.js';
import { postsRouter } from './routes/posts.js';
import { adminRouter } from './routes/admin.js';
import { chaosRouter } from './chaos/router.js';

// All config from env (.env local, .env.staging Neon). Nothing hardcoded.
const PORT = Number(process.env.BLOG_PORT ?? 3000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(metricsMiddleware(pool));

app.get('/', (_req, res) => {
  res.json({ service: 'blog', links: ['/posts', '/healthz', '/metrics', '/admin'] });
});
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'blog' }));
// Intentional error to verify Sentry end-to-end. Delete before production.
app.get('/debug-sentry', (_req, _res) => {
  Sentry.logger.info('User triggered test error', { action: 'test_error_endpoint' });
  throw new Error('My first Sentry error!');
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.use('/posts', postsRouter);
app.use('/chaos', chaosRouter);
app.use('/admin', adminRouter);
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(Sentry.expressErrorHandler());
app.use((err, _req, res, _next) => {
  console.error('[blog]', err);
  // Pool-acquire timeouts are the signature of DB saturation. Tagging them
  // keeps every one in a single Sentry issue, so the investigator sees one
  // clear "pool exhausted" story instead of a wall of unique errors.
  if (/timeout exceeded when trying to connect|Connection terminated/i.test(err?.message ?? '')) {
    Sentry.captureException(err, {
      tags: { failure_layer: 'database', cause: 'pool_exhausted' },
      level: 'error',
    });
    return res.status(503).json({ error: 'database unavailable' });
  }
  res.status(err.status ?? 500).json({ error: err.message ?? 'internal error' });
});

await ensureSchema();
app.listen(PORT, () => console.log(`[blog] listening on :${PORT}`));

process.on('SIGTERM', () => pool.end());
