import './env.js';
import express from 'express';
import { config, assertConfig } from './config.js';
import { ingestAlert, getIncident, listIncidents } from './incidents.js';
import { investigate } from './investigate.js';

assertConfig();

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: '3am' });
});

// Grafana contact point → POSTs here. 202 immediately; investigation runs async.
app.post('/webhook/grafana', express.json(), (req, res, next) => {
  try {
    const alerts = req.body?.alerts ?? [];
    const results = alerts.map((a) => handleAlert(a));
    res.status(202).json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

// Manual fallback for stage demo if alerts misfire:
// POST /trigger { "alertname": "HighErrorRate", "service": "blog" }
app.post('/trigger', express.json(), (req, res, next) => {
  try {
    const { alertname = 'ManualTrigger', service = 'blog' } = req.body ?? {};
    res.status(202).json({ ok: true, ...handleAlert({ alertname, service, status: 'firing' }) });
  } catch (err) {
    next(err);
  }
});

app.get('/incidents', (_req, res) => {
  res.json(listIncidents());
});

app.get('/incidents/:id', (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: 'not found' });
  res.json(incident);
});

app.use((err, _req, res, _next) => {
  console.error('[3am]', err);
  res.status(500).json({ error: err.message ?? 'internal error' });
});

function handleAlert(alert) {
  const { incident, created } = ingestAlert(
    {
      alertname: alert.labels?.alertname ?? alert.alertname ?? 'unknown',
      service: alert.labels?.service ?? alert.service ?? 'blog',
      status: alert.status ?? 'firing',
      startsAt: alert.startsAt,
      labels: alert.labels ?? {},
    },
    config.dedupeWindowMs
  );
  if (incident && created && incident.status === 'open') {
    // Fire-and-forget: status observable via GET /incidents/:id.
    void investigate(incident);
  }
  return {
    incidentId: incident?.id ?? null,
    created,
    status: incident?.status ?? 'ignored',
  };
}

app.listen(config.port, () => console.log(`[3am] listening on :${config.port}`));
