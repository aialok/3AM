import * as Sentry from '@sentry/node';
import { chaos, isOn, listActive, SCENARIOS } from './state.js';
import { chaosActive, chaosEvents } from '../metrics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- lifecycle ---------------------------------------------------------------

function markOn(name) {
  chaos.active.add(name);
  chaosActive.labels(name).set(1);
  chaosEvents.labels(`${name}-start`).inc();
  Sentry.logger.info('chaos started', { scenario: name });
}

function markOff(name) {
  chaos.active.delete(name);
  chaosActive.labels(name).set(0);
  Sentry.logger.info('chaos stopped', { scenario: name });
}

export async function startScenario(name, pool) {
  if (!SCENARIOS.includes(name)) throw Object.assign(new Error('unknown scenario'), { status: 404 });
  if (isOn(name)) return { scenario: name, active: true, note: 'already on' };
  await STARTERS[name](pool);
  markOn(name);
  return { scenario: name, active: true };
}

export async function stopAll() {
  const stopped = [];
  for (const name of listActive()) {
    const timer = chaos.timers.get(name);
    if (timer) {
      clearInterval(timer);
      chaos.timers.delete(name);
    }
    const cleanup = chaos.cleanups.get(name);
    if (cleanup) {
      chaos.cleanups.delete(name);
      await cleanup().catch((err) => Sentry.captureException(err));
    }
    markOff(name);
    stopped.push(name);
  }
  return { stopped };
}

// --- per-request hooks (called from real routes) ----------------------------

// GET /posts path: latency injection + lock contention + induced errors.
// queryFn receives a queryable (pool normally, a locked client while
// db-lock is on) so readers genuinely queue behind the lock holder.
export async function applyReadChaos(pool, queryFn) {
  if (isOn('latency')) {
    const ms = 800 + Math.random() * 1200;
    await sleep(ms);
    Sentry.logger.warn('chaos-induced slow read', { scenario: 'latency', durationMs: Math.round(ms) });
  }
  if (isOn('error-rate') && Math.random() < 0.3) {
    const err = new Error('chaos: induced read error');
    Sentry.captureException(err, { tags: { scenario: 'error-rate' } });
    chaosEvents.labels('error-rate').inc();
    throw Object.assign(err, { status: 500 });
  }
  if (!isOn('db-lock')) return queryFn(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(42)'); // blocks behind holder
    const out = await queryFn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// POST /posts path: fake downstream dependency failure.
export function applyWriteChaos() {
  if (!isOn('dependency-fail')) return;
  const err = new Error('chaos: downstream unavailable (fake dep 500)');
  Sentry.captureException(err, { tags: { scenario: 'dependency-fail' } });
  chaosEvents.labels('dependency-fail').inc();
  Sentry.logger.error('downstream call failed', { scenario: 'dependency-fail', dep: 'billing-mock' });
  throw Object.assign(err, { status: 502 });
}

// --- scenario starters -------------------------------------------------------

const STARTERS = {
  // Holds an advisory lock + one pool connection in the background.
  // The holder parks IDLE IN TRANSACTION (no query in flight) so the lock
  // is held while ROLLBACK stays instant — a mid-query holder would queue
  // the stop's ROLLBACK behind it. Reads via applyReadChaos queue behind
  // the same lock → real contention: p95 climbs, db_pool_waiting rises.
  // Released by /chaos/stop.
  async 'db-lock'(pool) {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(42)');
    } catch (err) {
      holder.release(err);
      throw err;
    }
    chaos.cleanups.set('db-lock', async () => {
      try {
        await holder.query('ROLLBACK');
      } finally {
        holder.release();
      }
    });
  },

  // Flag-driven; the actual sleep happens in applyReadChaos.
  async latency() {},

  // Background self-load: hammers GET /posts every 100ms.
  // Shows up as a traffic spike in Grafana (no new metrics needed).
  async 'traffic-spike'() {
    const port = process.env.BLOG_PORT ?? 3000;
    const timer = setInterval(() => {
      fetch(`http://localhost:${port}/posts`).catch(() => {});
    }, 100);
    chaos.timers.set('traffic-spike', timer);
  },

  // Background retry loop against a fake downstream that always fails.
  // Each attempt = Sentry error + log + chaos_events_total.
  async 'retry-storm'() {
    let attempt = 0;
    const timer = setInterval(() => {
      attempt += 1;
      const err = new Error(`chaos: downstream attempt ${attempt} failed, backing off`);
      Sentry.captureException(err, { tags: { scenario: 'retry-storm' } });
      Sentry.logger.error('retry attempt failed', { scenario: 'retry-storm', attempt });
      chaosEvents.labels('retry-storm').inc();
    }, 2000);
    chaos.timers.set('retry-storm', timer);
  },

  // Flag-driven; the actual failure happens in applyWriteChaos.
  async 'dependency-fail'() {},

  // Flag-driven; the dice roll happens in applyReadChaos.
  async 'error-rate'() {},
};
