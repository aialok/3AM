import express from 'express';

// 3AM service entry — incident-response workflow around TrueForge.
// Config comes from environment only (see .env.example). Nothing hardcoded.
const PORT = Number(process.env.THREE_AM_PORT ?? 3001);

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: '3am' });
});

// Grafana alert contact point → POSTs here. Full handling lands in Phase 5.
app.post('/webhook/grafana', express.json(), (req, res) => {
  const alerts = req.body?.alerts ?? [];
  console.log(`[3am] grafana webhook: ${alerts.length} alert(s)`);
  res.json({ ok: true, received: alerts.length, status: 'phase-5-todo' });
});

app.listen(PORT, () => {
  console.log(`[3am] listening on :${PORT}`);
});
