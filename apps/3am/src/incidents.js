// In-memory incident store with dedupe.
// Dedupe key: alertname + service. A firing alert within the dedupe window
// of an open incident joins it; `resolved` closes the incident.
let seq = 0;
const incidents = new Map(); // id -> incident

function dedupeKey(alertname, service) {
  return `${alertname}‖${service}`;
}

export function ingestAlert({ alertname, service, status, startsAt, labels = {} }, dedupeWindowMs) {
  const key = dedupeKey(alertname, service);
  const now = Date.now();

  if (status === 'resolved') {
    const open = [...incidents.values()].find((i) => i.key === key && i.status !== 'resolved');
    if (open) {
      open.status = 'resolved';
      open.resolvedAt = new Date(now).toISOString();
      open.timeline.push({ at: open.resolvedAt, event: `Alert ${alertname} resolved` });
      return { incident: open, created: false };
    }
    return { incident: null, created: false };
  }

  const existing = [...incidents.values()].find(
    (i) => i.key === key && i.status !== 'resolved' && now - i.lastAlertAt < dedupeWindowMs
  );
  if (existing) {
    existing.lastAlertAt = now;
    existing.alertCount += 1;
    existing.timeline.push({ at: new Date(now).toISOString(), event: `Re-alert ${alertname} (deduped)` });
    return { incident: existing, created: false };
  }

  seq += 1;
  const incident = {
    id: `INC-${String(seq).padStart(4, '0')}`,
    key,
    alertname,
    service,
    status: 'open',
    sessionId: null,
    rca: null,
    error: null,
    alertCount: 1,
    createdAt: new Date(now).toISOString(),
    lastAlertAt: now,
    resolvedAt: null,
    startsAt: startsAt ?? new Date(now).toISOString(),
    labels,
    timeline: [{ at: new Date(now).toISOString(), event: `Alert ${alertname} firing on ${service}` }],
  };
  incidents.set(incident.id, incident);
  return { incident, created: true };
}

export function getIncident(id) {
  return incidents.get(id) ?? null;
}

export function listIncidents() {
  return [...incidents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
