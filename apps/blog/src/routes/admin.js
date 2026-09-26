import { Router } from 'express';
import { snapshot } from '../metrics.js';
import { listActive } from '../chaos/state.js';

export const adminRouter = Router();

adminRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      metrics: await snapshot(),
      chaos: { active: listActive() },
    });
  } catch (err) {
    next(err);
  }
});
