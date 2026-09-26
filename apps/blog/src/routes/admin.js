import { Router } from 'express';
import { snapshot } from '../metrics.js';
import { listActive } from '../chaos/state.js';
import { getState as getTrafficState } from '../chaos/traffic.js';

export const adminRouter = Router();

// Where 3AM listens. Same compose network, so the service name resolves.
const THREE_AM_URL = process.env.THREE_AM_BASE_URL ?? 'http://3am:3001';

// Mirrors infra/grafana/provisioning/alerting/blog-rules.yml. The admin page
// fires these so the demo works before the cloud alert rules exist — and it
// posts the real Grafana webhook shape, so the same 3AM code path runs either
// way (the only difference is who sent the HTTP request).
const ALERTS = {
  HighErrorRate: { severity: 'page', summary: 'Blog 5xx rate above 5%' },
  HighLatency: { severity: 'page', summary: 'Blog p95 latency above 0.8s' },
  DbPoolExhausted: { severity: 'page', summary: 'Requests waiting for a Postgres connection' },
  TrafficSpike: { severity: 'warn', summary: 'Blog traffic above 5 RPS' },
};

// Derives the headline numbers from the raw counters so the admin UI can
// render cards without reimplementing PromQL. Rates are computed over a short
// window from the last scrape of cumulative counters.
function derive(metrics) {
  const total = metrics.http_requests_total ?? [];
  const buckets = metrics.http_request_duration_seconds_bucket ?? [];

  const sum = (rows, pred = () => true) =>
    rows.filter(pred).reduce((acc, r) => acc + (r.value ?? 0), 0);

  const errors = sum(total, (r) => String(r.labels?.status).startsWith('5'));
  const ok = sum(total, (r) => !String(r.labels?.status).startsWith('5'));
  const requests = errors + ok;

  // Buckets are cumulative-per-le; the last le is the +Inf total.
  const leValues = [...buckets]
    .map((b) => ({ le: b.labels?.le, value: b.value ?? 0 }))
    .filter((b) => b.le !== undefined)
    .sort((a, b) => (a.le === '+Inf' ? 1 : b.le === '+Inf' ? -1 : Number(a.le) - Number(b.le)));

  const totalCount = leValues.length ? leValues[leValues.length - 1].value : 0;

  // Linear-interpolated quantile within the bucket it falls into.
  const quantile = (q) => {
    if (!totalCount) return 0;
    const target = totalCount * q;
    let prev = 0;
    for (const b of leValues) {
      if (b.value >= target) {
        if (b.le === '+Inf') return prev;
        const span = b.value - prev || 1;
        const frac = (target - prev) / span;
        return prev + frac * (Number(b.le) - prev);
      }
      prev = b.value;
    }
    return prev;
  };

  const gauge = (name) => metrics[name]?.[0]?.value ?? 0;

  return {
    requests_total: requests,
    errors_total: errors,
    error_ratio: requests ? errors / requests : 0,
    p50_seconds: quantile(0.5),
    p95_seconds: quantile(0.95),
    db_pool_total: gauge('db_pool_total'),
    db_pool_idle: gauge('db_pool_idle'),
    db_pool_waiting: gauge('db_pool_waiting'),
  };
}

adminRouter.get('/status', async (_req, res, next) => {
  try {
    const metrics = await snapshot();
    res.json({
      ok: true,
      kpis: derive(metrics),
      chaos: { active: listActive() },
      traffic: getTrafficState(),
      chaosEvents: metrics.chaos_events_total ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// Fire a Grafana-shaped alert at 3AM's contact point. `firing` starts an
// investigation; `resolved` closes the open incident once chaos is stopped.
adminRouter.post('/alert', async (req, res, next) => {
  try {
    const { alertname, status = 'firing' } = req.body ?? {};
    const meta = ALERTS[alertname];
    if (!meta) {
      return res.status(400).json({ error: `unknown alertname. expected one of: ${Object.keys(ALERTS).join(', ')}` });
    }
    const now = new Date().toISOString();
    const payload = {
      receiver: '3am-webhook',
      status,
      orgId: 1,
      externalURL: process.env.GRAFANA_CLOUD_STACK ?? '',
      alerts: [
        {
          status,
          labels: { alertname, service: 'blog', severity: meta.severity },
          annotations: { summary: meta.summary },
          startsAt: now,
          endsAt: status === 'resolved' ? now : '0001-01-01T00:00:00Z',
          generatorURL: '',
          fingerprint: `${alertname}-blog-manual`,
        },
      ],
    };
    const r = await fetch(`${THREE_AM_URL}/webhook/grafana`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    res.status(r.status).json({ ok: r.ok, sent: alertname, status, threeAm: body });
  } catch (err) {
    next(err);
  }
});

// Thin proxy to 3AM so the page can show incident state without CORS games.
adminRouter.get('/incidents', async (_req, res, next) => {
  try {
    const r = await fetch(`${THREE_AM_URL}/incidents`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/incidents/:id', async (req, res, next) => {
  try {
    const r = await fetch(`${THREE_AM_URL}/incidents/${encodeURIComponent(req.params.id)}`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/incidents/:id/trace', async (req, res, next) => {
  try {
    const r = await fetch(`${THREE_AM_URL}/incidents/${encodeURIComponent(req.params.id)}/trace`);
    res.status(r.status).json(await r.json());
  } catch (err) {
    next(err);
  }
});
