import { Router } from 'express';
import { pool } from '../db.js';
import { listActive } from './state.js';
import { startScenario, stopAll } from './scenarios.js';

export const chaosRouter = Router();

chaosRouter.get('/', (_req, res) => {
  res.json({ active: listActive() });
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
