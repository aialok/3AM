import { Router } from 'express';
import { snapshot } from '../metrics.js';
import { listActive } from '../chaos/state.js';

export const adminRouter = Router();

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
      chaosEvents: metrics.chaos_events_total ?? [],
    });
  } catch (err) {
    next(err);
  }
});
