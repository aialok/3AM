import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Loads repo-root .env by default, or ENV_FILE override (e.g. .env.staging).
// Resolved from this file's location, so it works from any cwd.
// Import this module FIRST (before db.js reads process.env).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
dotenv.config({ path: path.resolve(repoRoot, process.env.ENV_FILE ?? '.env') });
