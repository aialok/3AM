import * as Sentry from '@sentry/node';

// Background load generator. Produces steady, realistic traffic so the Grafana
// dashboards have a live baseline to contrast incidents against.
//
// Rate is set by dispatching in batches on a fixed 100ms tick, which is far
// more accurate than one setTimeout per request (those drift badly at 100+ RPS)
// and keeps the event loop responsive.
const TICK_MS = 100;

const state = {
  running: false,
  rps: 0,
  timer: null,
  sent: 0,
  dropped: 0,
};

// Mix of cheap and DB-backed reads. Weighted toward cheap routes so the
// generator can actually deliver its target rate — a load test that pins the
// connection pool just measures the pool, not the app. Still hits /posts often
// enough that the latency and error panels stay meaningful.
const PATHS = [
  '/', '/', '/', '/', '/',          // static — no DB
  '/healthz', '/healthz',           // static — no DB
  '/posts',                         // DB round trip
  '/posts/1',                       // DB round trip
];

let inflight = 0;
const MAX_INFLIGHT = Number(process.env.LOAD_MAX_INFLIGHT ?? 1500);

function fire(path) {
  if (inflight >= MAX_INFLIGHT) {
    state.dropped += 1;
    return;
  }
  inflight += 1;
  state.sent += 1;
  fetch(`http://127.0.0.1:${process.env.BLOG_PORT ?? 3000}${path}`)
    .catch(() => {})
    .finally(() => {
      inflight -= 1;
    });
}

function tick() {
  const perTick = Math.round((state.rps * TICK_MS) / 1000);
  for (let i = 0; i < perTick; i += 1) {
    fire(PATHS[i % PATHS.length]);
  }
}

export function setRps(rps) {
  const next = Math.max(0, Math.round(Number(rps) || 0));
  state.rps = next;
  if (next > 0 && !state.running) return start();
  if (next === 0 && state.running) return stop();
  return state;
}

export function start() {
  if (state.timer) return state;
  if (!state.rps) state.rps = Number(process.env.BASELINE_RPS ?? 100);
  if (!state.rps) return state;
  state.running = true;
  state.timer = setInterval(tick, TICK_MS);
  Sentry.logger.info('load generator started', { rps: state.rps });
  return state;
}

export function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  state.rps = 0;
  Sentry.logger.info('load generator stopped');
  return state;
}

export function getState() {
  return {
    running: state.running,
    rps: state.rps,
    sent: state.sent,
    dropped: state.dropped,
    inflight,
  };
}

// Start on boot so the dashboards are never empty. BASELINE_RPS=0 opts out.
export function startOnBoot() {
  const baseline = Number(process.env.BASELINE_RPS ?? 100);
  if (baseline > 0) setRps(baseline);
  return getState();
}
