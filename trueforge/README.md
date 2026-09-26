# TrueForge setup for 3AM

Docs: https://trueforge.dev/introduction

## 1. Run the server (hackathon: local mode)

```bash
npx @truefoundry/trueforge
```

Open http://localhost:8790. Local mode = SQLite, no login, keep on localhost.

## 2. Configure a model provider (bring your own)

Settings → Models → pick a provider from the catalog → paste API key → Create.
Note the model FQN, e.g. `anthropic/claude-sonnet-4-6`, and set it as
`TRUEFORGE_MODEL` in your `.env` (see `.env.example`).

## 3. Connect Grafana + Sentry MCP servers

Settings → Connectors → Add MCP Server (or pick from catalog if listed):

- `grafana` → URL from `GRAFANA_MCP_URL`, header auth with `GRAFANA_MCP_TOKEN`
- `sentry` → URL from `SENTRY_MCP_URL`, header auth with `SENTRY_MCP_TOKEN`

See `mcp.json` for the exact connector shape. Credentials stay in the
connector — never in `agent.json`.

## 4. Save the 3AM agent

Option A — UI: Build Agent → copy model, instructions, MCP servers
(`grafana`, `sentry`, read-only), runtime config from `agent.json` → Save
as `three-am-investigator`.

Option B — SDK (`@truefoundry/trueforge-sdk`):

```js
import { TrueForge } from '@truefoundry/trueforge-sdk';
import agent from './agent.json' assert { type: 'json' };

const client = new TrueForge({
  baseUrl: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
  timeoutInSeconds: 600,
});

// Replace MODEL_FROM_ENV_SEE_README with process.env.TRUEFORGE_MODEL first.
await client.agents.create({
  name: agent.name,
  description: agent.description,
  manifest: agent.manifest,
});
```

## 5. How 3AM uses it (Phase 5)

Per incident: `sessions.create({ agent: { name: 'three-am-investigator' } })`
→ `sessions.createTurnStream(session.id, { input: [incident prompt] })`
→ parse `model.message.delta` until `turn.done` → `state.output` is the
RCA JSON (response_format guarantees the shape) → Slack + Notion.
One TrueForge session per independent incident.
