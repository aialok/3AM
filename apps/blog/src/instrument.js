import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

// Loaded via `node --import ./src/instrument.js` so Sentry initializes
// before any other module. DSN + toggles come from env, never hardcoded.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv.config({ path: path.resolve(repoRoot, process.env.ENV_FILE ?? '.env') });

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.log('[blog] SENTRY_DSN unset — Sentry disabled');
} else {
  Sentry.init({
    dsn,
    enableLogs: true,
    tracesSampleRate: 1.0,
  });
  console.log('[blog] Sentry enabled (errors + logs + traces)');
}
