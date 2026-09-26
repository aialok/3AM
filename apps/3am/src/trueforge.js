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
  // Reference only MCP servers actually configured on the server —
  // unknown names make session creation fail (422). The loop works
  // tool-less today and gains tools automatically once Grafana/Sentry
  // connectors are added (Settings → Connectors).
  spec.mcp_servers = await filterConfiguredServers(spec.mcp_servers ?? []);
  return { name: agentJson.name, spec };
}

async function filterConfiguredServers(wanted) {
  try {
    const res = await fetch(`${config.trueforge.baseUrl}/api/v1/settings/mcp-servers`);
    const { data } = await res.json();
    const byName = new Map((data ?? []).map((s) => [s.name, s]));
    const kept = [];
    for (const s of wanted) {
      const found = byName.get(s.name);
      const status = found?.auth_status?.status;
      // Usable headlessly: configured + (already authenticated, or
      // header/no-auth since those carry no interactive step).
      // auth_required (OAuth pending) would pause the turn forever.
      const ready =
        found && (status === 'authenticated' || ['header', 'none'].includes(found.manifest?.auth?.type));
      if (ready) kept.push(s);
      else console.log(`[3am] MCP unusable, skipping: ${s.name} (${found ? status : 'not configured'})`);
    }
    return kept;
  } catch (err) {
    console.log(`[3am] could not list MCP servers, sending spec as-is: ${err.message}`);
    return wanted;
  }
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
