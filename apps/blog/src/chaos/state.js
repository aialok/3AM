// Central chaos registry: which scenarios are on, plus cleanup handles.
// Single source of truth — read by routes, reported by /admin/status.
export const chaos = {
  active: new Set(),
  timers: new Map(),
  cleanups: new Map(),
};

export const SCENARIOS = [
  'db-lock',
  'latency',
  'traffic-spike',
  'retry-storm',
  'dependency-fail',
  'error-rate',
];

export function isOn(name) {
  return chaos.active.has(name);
}

export function listActive() {
  return [...chaos.active];
}
