import client from 'prom-client';

// ---------------------------------------------------------------------------
// All Prometheus instrumentation for the blog lives here.
// The app serves it on the SAME server via GET /metrics (scraped by
// Prometheus). No separate metrics server — one less moving part for demo.
// ---------------------------------------------------------------------------

client.collectDefaultMetrics();

export const register = client.register;

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 0.8, 1, 2, 5],
});

const httpTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const dbPoolTotal = new client.Gauge({
  name: 'db_pool_total',
  help: 'Total connections in pg pool',
});

const dbPoolIdle = new client.Gauge({
  name: 'db_pool_idle',
  help: 'Idle connections in pg pool',
});

const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_waiting',
  help: 'Requests waiting for a pg connection',
});

export const chaosEvents = new client.Counter({
  name: 'chaos_events_total',
  help: 'Chaos-induced events (starts, induced errors, retry attempts)',
  labelNames: ['scenario'],
});

export const chaosActive = new client.Gauge({
  name: 'chaos_active',
  help: '1 when the chaos scenario is active, else 0',
  labelNames: ['scenario'],
});

// Mount-aware route label: "/posts/:id", not "/:id" or raw "/posts/42".
// Unmatched paths (404s) collapse to "unmatched" to bound cardinality.
function routeLabel(req) {
  if (!req.route) return 'unmatched';
  const full = `${req.baseUrl}${req.route.path}`;
  return full.length > 1 ? full.replace(/\/$/, '') : full;
}

// Records latency + traffic per finished response and refreshes pg pool
// gauges. Mount BEFORE routes so every handler is covered.
export function metricsMiddleware(pool) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const labels = {
        method: req.method,
        route: routeLabel(req),
        status: res.statusCode,
      };
      httpTotal.inc(labels);
      httpDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
      if (pool) {
        dbPoolTotal.set(pool.totalCount);
        dbPoolIdle.set(pool.idleCount);
        dbPoolWaiting.set(pool.waitingCount);
      }
    });
    next();
  };
}

// Compact snapshot for the admin panel. Same data as /metrics,
// JSON-shaped — the admin route must not touch prom-client directly.
export async function snapshot() {
  const metrics = await register.getMetricsAsJSON();
  const valuesOf = (name) => metrics.find((m) => m.name === name)?.values ?? [];
  return {
    http_requests_total: valuesOf('http_requests_total'),
    // Histogram rows are one entry per (le, method, route, status) — the
    // admin panel needs the buckets to compute p50/p95 client-side.
    http_request_duration_seconds_bucket: valuesOf('http_request_duration_seconds').filter(
      (v) => v.metricName === 'http_request_duration_seconds_bucket'
    ),
    db_pool_total: valuesOf('db_pool_total'),
    db_pool_idle: valuesOf('db_pool_idle'),
    db_pool_waiting: valuesOf('db_pool_waiting'),
    chaos_active: valuesOf('chaos_active'),
    chaos_events_total: valuesOf('chaos_events_total'),
  };
}
