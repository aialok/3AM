import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import { config } from './config.js';

// Single TrueForge client for the service.
export const client = new TrueForge({
  baseUrl: config.trueforge.baseUrl,
  timeoutInSeconds: 600,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// agent.json lives at the repo root, but nesting depth differs between
// host dev (apps/3am/src) and container (/app/src) — search upward.
async function findAgentJson() {
  let dir = __dirname;
  while (true) {
    const candidate = path.join(dir, 'trueforge', 'agent.json');
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error('trueforge/agent.json not found from ' + __dirname);
      dir = parent;
    }
  }
}

// Inline agent spec, sourced from trueforge/agent.json (single source of
// truth) with the model overridden from env. Inline — not a saved-agent
// reference — because response_format (the RCA JSON schema) is API-only and
// can't be stored via the UI. This guarantees parseable RCA output.
export async function loadAgentSpec() {
  const agentJson = JSON.parse(await readFile(await findAgentJson(), 'utf8'));
  const spec = structuredClone(agentJson.manifest);
  if (config.trueforge.model) spec.model.name = config.trueforge.model;
  return { name: agentJson.name, spec };
}

// One TrueForge session per incident. Returns the session id.
export async function openIncidentSession(incident) {
  const { spec } = await loadAgentSpec();
  const { data: session } = await client.sessions.create({ agent: { spec } });
  incident.sessionId = session.id;
  incident.timeline.push({ at: new Date().toISOString(), event: `TrueForge session ${session.id} opened` });
  return session;
}

// Non-streaming turn + poll (resilient for server-side async work).
// Resolves with the terminal turn state.
export async function runTurnToCompletion(sessionId, input) {
  const { data: created } = await client.sessions.createTurn(sessionId, { input });
  const deadline = Date.now() + config.investigateTimeoutMs;
  let turn = created;
  while (turn.state.status === 'running') {
    if (Date.now() > deadline) throw new Error('investigation timed out');
    await new Promise((r) => setTimeout(r, 5000));
    ({ data: turn } = await client.sessions.getTurn(sessionId, created.id));
  }
  return turn;
}
