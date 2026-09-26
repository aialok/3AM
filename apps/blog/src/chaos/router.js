import { Router } from 'express';
import { pool } from '../db.js';
import { listActive } from './state.js';
import { startScenario, stopAll } from './scenarios.js';
import * as traffic from './traffic.js';

export const chaosRouter = Router();

chaosRouter.get('/', (_req, res) => {
  res.json({ active: listActive(), traffic: traffic.getState() });
});

// Set the standing load. rps=0 stops it entirely.
chaosRouter.post('/traffic', (req, res) => {
  const rps = Number(req.body?.rps);
  if (!Number.isFinite(rps) || rps < 0) {
    return res.status(400).json({ error: 'rps must be a non-negative number' });
  }
  res.json({ ok: true, traffic: traffic.setRps(rps) });
});

chaosRouter.post('/stop', async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await stopAll()) });
  } catch (err) {
    next(err);
  }
});

chaosRouter.post('/:scenario', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await startScenario(req.params.scenario, pool)) });
  } catch (err) {
    next(err);
  }
});
