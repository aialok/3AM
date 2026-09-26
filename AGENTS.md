# AGENTS.md

# 3AM

3AM is an autonomous incident-response agent built on top of the open-source TrueForge agent harness.

> **When production breaks at 3AM, 3AM is already awake.**

The goal is simple: when an incident happens, 3AM automatically investigates it before an engineer starts debugging.

## Core Flow

```text
Incident / Alert
      ↓
Deduplicate
      ↓
Create Incident
      ↓
Create TrueForge Session
      ↓
Investigate
      ↓
Grafana MCP + Sentry MCP
      ↓
Correlate Evidence
      ↓
Generate RCA
      ↓
Slack + Notion
```

## TrueForge

TrueForge is the agent harness.

3AM should not implement its own agent runtime.

TrueForge handles:

* agent sessions
* MCP tools
* skills
* model execution
* context
* agent lifecycle

3AM handles the incident-response workflow around the agent.

## Investigation

The agent primarily uses:

### Grafana

Used to investigate:

* metrics
* latency
* error rates
* traffic
* infrastructure signals
* time-series correlations

### Sentry

Used to investigate:

* exceptions
* error spikes
* affected endpoints
* stack traces
* error frequency
* timestamps

The agent should correlate evidence from both systems rather than relying on a single signal.

## Incident Session

Every independent incident gets its own TrueForge session.

Example:

```text
INC-1024
    ↓
TrueForge Session
    ↓
Grafana + Sentry
    ↓
Investigation
    ↓
RCA
```

Multiple alerts belonging to the same incident should be deduplicated before creating a new investigation.

## RCA

The agent should produce:

* incident summary
* when it started
* affected service
* customer impact when available
* timeline
* root cause
* supporting evidence
* confidence
* recommended mitigation

The RCA should clearly distinguish observed facts from hypotheses.

## Communication

After investigation:

**Slack**

Send a concise incident summary and RCA link.

**Notion**

Store the complete RCA and investigation details.

## Demo / Simulator

The hackathon includes a simulated production application.

The simulator should generate realistic incidents such as:

* traffic spikes
* database contention
* retry storms
* dependency failures
* increased error rates

The simulator exists to demonstrate the complete flow:

```text
Break application
      ↓
Metrics change
      ↓
Sentry errors appear
      ↓
Incident triggered
      ↓
3AM investigates
      ↓
Grafana + Sentry
      ↓
RCA
      ↓
Slack + Notion
```

## Important Principle

Do not over-engineer the hackathon version.

The core experience is:

> **An incident happens → 3AM investigates Grafana and Sentry → 3AM explains what happened → engineers receive the RCA.**

Everything else is secondary.

---

## Build Decisions (locked)

* **Demo app:** Simple blogs website — Node.js Express + Postgres
  * Local Postgres for now, Neon Postgres when deploying
* **Observability:** Prometheus + Grafana + Sentry, all wired into the blog app
* **Agent harness:** TrueForge (open-source). Docs: https://trueforge.dev/introduction
  * Packages: `@truefoundry/trueforge-sdk` + `@truefoundry/trueforge-ui` via `pnpm add`
  * Server: `npx @truefoundry/trueforge` locally (port 8790, SQLite, no-auth) for hackathon
  * 3AM uses SDK: `sessions.create()` + `sessions.createTurnStream()` — inline agent spec or saved agent name
* **Comms:** Real Slack + Real Notion integrations (env tokens, no mocks)
* **Runtime:** Docker Compose for stage demo (one command up)
* **Package manager:** pnpm

## Planned Repo Structure

```text
3AM/
  AGENTS.md
  package.json              # pnpm workspace root
  docker-compose.yml        # blog + postgres + prometheus + grafana + trueforge-server + 3am
  .env.example

  apps/
    blog/                   # demo prod app: Express + Postgres + Prometheus + Sentry
      src/
        index.js            # express app, routes, /metrics, /healthz, /admin
        db.js               # pg pool (local PG now, Neon via DATABASE_URL later)
        metrics.js          # prom-client: http latency, error rate, db pool, traffic
        sentry.js           # @sentry/node init
        routes/
          posts.js          # blog CRUD
          admin.js          # GET /admin data + POST actions (traffic controls, chaos triggers)
        chaos/              # break-glass endpoints: db-lock, latency, traffic-spike,
                            # retry-storm, dependency-fail, error-rate (+ stop)
        public/
          admin.html        # admin panel: traffic sim buttons + incident buttons + status
      Dockerfile
      package.json

    3am/                    # incident-response workflow around TrueForge (NOT agent runtime)
      src/
        index.js            # express server: /webhook/grafana -> dedupe -> incident -> session -> RCA -> notify
        incidents.js        # incident create + in-memory dedupe (same service+alert → same INC)
        trueforge.js        # @truefoundry/trueforge-sdk client: create session + stream turn
        agent.js            # 3AM agent spec: model, instructions, Grafana+Sentry MCP, RCA format
        investigate.js      # builds investigation prompt, parses RCA from turn events
        notify/
          slack.js          # real Slack post: concise summary + RCA link
          notion.js         # real Notion page: full RCA + timeline + evidence
      Dockerfile
      package.json

  infra/
    prometheus/
      prometheus.yml        # scrapes blog:/metrics
      alert.rules.yml       # HighLatency, HighErrorRate, DbPoolExhausted, TrafficSpike
    grafana/
      provisioning/
        datasources/        # Prometheus datasource
        alerting/           # contact point: webhook http://3am:3001/webhook/grafana
      dashboards/
        blog-overview.json
    postgres/
      init.sql              # posts table + seed data

  trueforge/
    agent.json              # saved 3AM agent definition (model, instructions, MCP, skills)
    mcp.json                # Grafana MCP + Sentry MCP server configs
    README.md               # how to run server, configure model provider, connect MCPs
```

## TrueForge Integration Notes

* TrueForge owns: agent sessions, MCP tools, skills, model execution, context, lifecycle.
* 3AM owns: dedupe → incident → `client.sessions.create({ agent: { spec | name } })` →
  `client.sessions.createTurnStream(session.id, { input })` → parse `model.message.delta` until `turn.done` → RCA → Slack + Notion.
* One TrueForge session per independent incident (`INC-xxxx` → `session.id` mapping stored on incident).
* Agent needs two MCP servers configured on TrueForge server: **Grafana** (metrics/latency/traffic) + **Sentry** (exceptions/stack traces).
  * Configure via Settings → Connectors in UI, or via MCP API + `trueforge/mcp.json`.
* Model provider is bring-your-own: configure once in TrueForge UI → Settings → Models.
* Chat UI: bundled with server at `:8790`, plus `@truefoundry/trueforge-ui` embed for 3AM RCA view (Phase 4, optional).

## Demo Blog Requirements

* Routes: `GET /`, `GET /posts`, `GET /posts/:id`, `POST /posts`, `GET /healthz`, `GET /metrics`
* Every route: prom-client histogram (latency) + counter (traffic/errors) + Sentry span/error capture
* Postgres: `posts(id, title, body, created_at)` + seed posts; expose `db_pool_*` gauges for contention demo
* Chaos endpoints (POST) — each must move Grafana AND emit Sentry errors:
  * `/chaos/db-lock` — lock contention: `BEGIN; SELECT pg_advisory_xact_lock(42); pg_sleep(5)` + pool exhaustion (hold 10 conns)
  * `/chaos/latency` — p95 spike: `pg_sleep` 800ms–2s injected on `GET /posts`
  * `/chaos/traffic-spike` — background load generator (10x RPS loop)
  * `/chaos/retry-storm` — downstream retry loop with backoff failure
  * `/chaos/dependency-fail` — fake external dep 500s
  * `/chaos/error-rate` — random 500s on blog routes
  * `/chaos/stop` — reset all flags, kill background loops

## Admin Panel (prod-traffic + incident simulator)

`GET /admin` — single static page (`apps/blog/src/public/admin.html`, no build step) for stage demo. No auth (hackathon only).

* **Traffic sim:** buttons Start Normal Traffic / Start Spike / Stop — hits blog routes in background, drives Grafana traffic + latency panels.
* **Incident sim:** one button per chaos scenario (DB Lock, Latency, Retry Storm, Dependency Fail, Error Rate) + big red Stop All. Each button = `POST /chaos/*`. Shows active scenario badge.
* **Status:** live `/healthz` + `/metrics` snapshot (RPS, p95, error %, db pool) polled every 2s + link to Grafana dashboard.
* Must work with plain fetch + inline JS so it runs inside Docker with zero deps.

## Alerting (Grafana → 3AM, automatic)

No manual trigger in the happy-path demo. Flow:

```text
/chaos/* breaks blog
      ↓
/metrics moves (latency / errors / db pool)
      ↓
Prometheus alert.rules.yml fires (HighLatency, HighErrorRate, DbPoolExhausted, TrafficSpike)
      ↓
Grafana alert (Prometheus datasource) → contact point webhook POST http://3am:3001/webhook/grafana
      ↓
3AM: dedupe (same alertname+service within 5 min → same INC) → create incident
      ↓
3AM: TrueForge session → investigate Grafana + Sentry → RCA → Slack + Notion
```

* Prometheus evaluates `infra/prometheus/alert.rules.yml`; Grafana reads same Prometheus as datasource and owns the contact point.
* 3AM exposes `POST /webhook/grafana` accepting Grafana webhook payload (`alerts[]` with `labels.alertname`, `status=firing|resolved`).
* Dedupe key: `alertname + service`. Firing re-alerts for same key update the open INC; `resolved` closes it.
* Manual `POST /trigger` also kept as fallback for stage demo if alerts misfire.

## Env / Secrets (.env.example)

```text
# blog
DATABASE_URL=postgres://blog:blog@postgres:5432/blog
SENTRY_DSN=
# 3am
TRUEFORGE_BASE_URL=http://localhost:8790
TRUEFORGE_AGENT_NAME=three-am-investigator
SLACK_BOT_TOKEN=
SLACK_CHANNEL_ID=
NOTION_TOKEN=
NOTION_DATABASE_ID=
```

## Build Phases (do one at a time)

* [x] **Phase 0 — Root:** `package.json` (pnpm workspaces), `.env.example`, `.gitignore`, `docker-compose.yml` skeleton
* [x] **Phase 1 — Blog app:** `apps/blog/` Express + pg + prom-client + Sentry + CRUD + `/metrics` + seed + `/admin` panel shell
* [x] **Phase 2 — Infra:** `infra/prometheus.yml` + `alert.rules.yml`, `infra/grafana/` datasource + dashboard + alert contact-point webhook, `infra/postgres/init.sql`, wire into compose
* [x] **Phase 3 — Chaos + Admin wiring:** `apps/blog/src/chaos/` db-lock + latency + 4 more + `/chaos/stop`, wire admin buttons, verified Grafana + Sentry move + full auto-trigger loop (alerts fire → Grafana webhooks hit 3AM → resolve on stop)
* [x] **Phase 4 — TrueForge:** `trueforge/agent.json` + `mcp.json` + README; `pnpm add @truefoundry/trueforge-sdk @truefoundry/trueforge-ui`; verified server + session + turn stream (`apps/3am/scripts/verify-agent.mjs` → `done`)
* [ ] **Phase 5 — 3AM core:** `apps/3am/` `/webhook/grafana` + dedupe + incidents + trueforge client + RCA parse (+ `/trigger` fallback)
* [ ] **Phase 6 — Notify:** real Slack + Notion posters, RCA markdown template (facts vs hypotheses)
* [ ] **Phase 7 — Demo script:** end-to-end `chaos → metrics → Grafana alert fires → webhook → RCA → Slack/Notion`, one-command compose up

## Hackathon Demo Script

1. Open `/admin` → Start Normal Traffic. Show blog healthy in Grafana.
2. Click DB Lock (or Latency) in admin panel.
3. Grafana dashboard spikes → alert fires → auto-POSTs to 3AM webhook.
4. 3AM dedupes → creates INC → TrueForge session investigates Grafana + Sentry, streams reasoning.
5. RCA lands in Slack (concise) + Notion (full).
6. Click Stop All in admin panel → metrics recover → `resolved` closes INC.
