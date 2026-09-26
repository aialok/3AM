import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Loads repo-root .env by default, or ENV_FILE override (e.g. .env.staging).
// This file lives at apps/3am/src/env.js, so repo root is 3 levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.resolve(repoRoot, process.env.ENV_FILE ?? '.env') });
