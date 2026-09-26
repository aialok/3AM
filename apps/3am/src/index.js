import './env.js';
import express from 'express';
import { config, assertConfig } from './config.js';
import { ingestAlert, getIncident, listIncidents } from './incidents.js';
import { buildTrace } from './trace.js';
import { initIncidentsSchema } from './incidents-db.js';
import { investigate } from './investigate.js';

assertConfig();
initIncidentsSchema().catch((err) => { console.error('[3am] DB init failed:', err); process.exit(1); });

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: '3am' });
});

// Grafana contact point → POSTs here. 202 immediately; investigation runs async.
app.post('/webhook/grafana', express.json(), (req, res, next) => {
  Promise.all((req.body?.alerts ?? []).map((a) => handleAlert(a)))
    .then((results) => res.status(202).json({ ok: true, results }))
    .catch(next);
});

// Manual fallback for stage demo if alerts misfire:
// POST /trigger { "alertname": "HighErrorRate", "service": "blog" }
app.post('/trigger', express.json(), (req, res, next) => {
  const { alertname = 'ManualTrigger', service = 'blog' } = req.body ?? {};
  handleAlert({ alertname, service, status: 'firing' })
    .then((result) => res.status(202).json({ ok: true, ...result }))
    .catch(next);
});

app.get('/incidents', (_req, res, next) => {
  listIncidents().then((rows) => res.json(rows)).catch(next);
});

app.get('/incidents/:id', (req, res, next) => {
  getIncident(req.params.id)
    .then((incident) => {
      if (!incident) return res.status(404).json({ error: 'not found' });
      res.json(incident);
    })
    .catch(next);
});

// How the agent actually investigated: the MCP calls it made, the queries it
// ran, and what came back. Lets a human audit the reasoning.
app.get('/incidents/:id/trace', (req, res, next) => {
  getIncident(req.params.id)
    .then((incident) => {
      if (!incident) return res.status(404).json({ error: 'not found' });
      return buildTrace(incident.session_id)
        .then((trace) => res.json({ incidentId: incident.id, status: incident.status, ...trace }))
        .catch((err) => res.json({ incidentId: incident.id, steps: [], error: err.message }));
    })
    .catch(next);
});

app.use((err, _req, res, _next) => {
  console.error('[3am]', err);
  res.status(500).json({ error: err.message ?? 'internal error' });
});

async function handleAlert(alert) {
  const { incident, created } = await ingestAlert(
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
