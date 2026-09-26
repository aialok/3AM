import { Router } from 'express';
import * as Sentry from '@sentry/node';
import { pool } from '../db.js';
import { applyReadChaos, applyWriteChaos } from '../chaos/scenarios.js';

export const postsRouter = Router();

postsRouter.get('/', async (_req, res, next) => {
  try {
    const { rows } = await applyReadChaos(pool, (db) =>
      db.query('SELECT id, title, body, created_at FROM posts ORDER BY id DESC')
    );
    res.json(rows);
  } catch (err) {
    Sentry.captureException(err);
    next(err);
  }
});

postsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await applyReadChaos(pool, (db) =>
      db.query('SELECT id, title, body, created_at FROM posts WHERE id = $1', [req.params.id])
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    Sentry.captureException(err);
    next(err);
  }
});

postsRouter.post('/', async (req, res, next) => {
  try {
    applyWriteChaos();
    const { title, body } = req.body ?? {};
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const { rows } = await pool.query(
      'INSERT INTO posts (title, body) VALUES ($1, $2) RETURNING id, title, body, created_at',
      [title, body]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    Sentry.captureException(err);
    next(err);
  }
});
