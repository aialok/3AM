import { incidentsPool } from './incidents-db.js';

let seq = 0;

function dedupeKey(alertname, service) {
  return `${alertname}‖${service}`;
}

export async function ingestAlert({ alertname, service, status, startsAt, labels = {} }, dedupeWindowMs) {
  const key = dedupeKey(alertname, service);
  const now = Date.now();

  if (status === 'resolved') {
    const open = await incidentsPool.query(
      `SELECT * FROM incidents WHERE alertname = $1 AND service = $2 AND status != 'resolved' ORDER BY created_at DESC LIMIT 1`,
      [alertname, service]
    );
    if (open.rows[0]) {
      const incident = open.rows[0];
      const timeline = [...(incident.timeline || []), { at: new Date(now).toISOString(), event: `Alert ${alertname} resolved` }];
      await incidentsPool.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = $1, timeline = $2 WHERE id = $3`,
        [new Date(now).toISOString(), JSON.stringify(timeline), incident.id]
      );
      return { incident: { ...incident, status: 'resolved', resolvedAt: new Date(now).toISOString(), timeline }, created: false };
    }
    return { incident: null, created: false };
  }

  // Check for existing open incident within dedupe window
  const existing = await incidentsPool.query(
    `SELECT * FROM incidents WHERE alertname = $1 AND service = $2 AND status != 'resolved' ORDER BY created_at DESC LIMIT 1`,
    [alertname, service]
  );

  if (existing.rows[0]) {
    const incident = existing.rows[0];
    const lastAlertAt = new Date(incident.last_alert_at).getTime();
    if (now - lastAlertAt < dedupeWindowMs) {
      const timeline = [...(incident.timeline || []), { at: new Date(now).toISOString(), event: `Re-alert ${alertname} (deduped)` }];
      await incidentsPool.query(
        `UPDATE incidents SET alert_count = alert_count + 1, last_alert_at = $1, timeline = $2 WHERE id = $3`,
        [new Date(now).toISOString(), JSON.stringify(timeline), incident.id]
      );
      return { incident: { ...incident, alertCount: incident.alert_count + 1, lastAlertAt: now, timeline }, created: false };
    }
  }

  seq += 1;
  const id = `INC-${String(seq).padStart(4, '0')}`;
  const createdAt = new Date(now).toISOString();
  const timeline = [{ at: createdAt, event: `Alert ${alertname} firing on ${service}` }];

  await incidentsPool.query(
    `INSERT INTO incidents (id, alertname, service, status, alert_count, created_at, last_alert_at, starts_at, labels, timeline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, alertname, service, 'open', 1, createdAt, createdAt, startsAt ?? createdAt, JSON.stringify(labels), JSON.stringify(timeline)]
  );

  const incident = {
    id, key: dedupeKey(alertname, service), alertname, service,
    status: 'open', sessionId: null, rca: null, error: null,
    alertCount: 1, createdAt, lastAlertAt: now, resolvedAt: null,
    startsAt: startsAt ?? createdAt, labels, timeline
  };
  return { incident, created: true };
}

export async function getIncident(id) {
  const result = await incidentsPool.query(`SELECT * FROM incidents WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listIncidents() {
  const result = await incidentsPool.query(`SELECT * FROM incidents ORDER BY created_at DESC`);
  return result.rows;
}

export async function updateIncidentSession(id, sessionId) {
  await incidentsPool.query(`UPDATE incidents SET session_id = $1 WHERE id = $2`, [sessionId, id]);
}

export async function updateIncidentRCA(id, rca) {
  await incidentsPool.query(`UPDATE incidents SET rca = $1, status = 'done' WHERE id = $2`, [JSON.stringify(rca), id]);
}

export async function updateIncidentError(id, error) {
  await incidentsPool.query(`UPDATE incidents SET error = $1, status = 'error' WHERE id = $2`, [error, id]);
}

export async function addTimelineEvent(id, event) {
  const result = await incidentsPool.query(`SELECT timeline FROM incidents WHERE id = $1`, [id]);
  if (result.rows[0]) {
    const timeline = [...(result.rows[0].timeline || []), event];
    await incidentsPool.query(`UPDATE incidents SET timeline = $1 WHERE id = $2`, [JSON.stringify(timeline), id]);
  }
}