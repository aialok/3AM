import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Loads the repo-root .env by default. ENV_FILE selects a sibling file
// (e.g. ".env.staging") and is always resolved against the repo root —
// only its basename is used, so a stray "../../.env" still lands correctly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const envPath = path.resolve(repoRoot, path.basename(process.env.ENV_FILE ?? '.env'));
dotenv.config({ path: envPath });
