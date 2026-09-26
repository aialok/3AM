# 3AM — Autonomous Incident Response

> **When production breaks at 3AM, 3AM is already awake.**

3AM is an autonomous incident-response agent that automatically investigates production incidents before engineers start debugging. Built on [TrueForge](https://trueforge.dev) (open-source agent harness), it correlates metrics from **Grafana** and errors from **Sentry** to generate a Root Cause Analysis (RCA) — then posts it to **Slack** and **Notion**.

## The Problem

```
Incident at 3AM
       ↓
Engineer wakes up, opens 5 tabs
       ↓
Grafana (metrics) → Sentry (errors) → Logs → Traces
       ↓
Manual correlation → Hypothesize → Test → Fix
       ↓
45 minutes later: "DB pool exhaustion from retry storm"
```

**3AM automates the investigation** — you wake up to a complete RCA with evidence.

## How It Works: The Complete Flow

![3AM Architecture](https://github.com/user-attachments/assets/7f9ca603-4342-4fdb-bb35-7fdce03da1f1)

## Loom Videos

https://www.loom.com/share/1892a6c703304153818e5b1354d4d438

### What Happens When Latency Spikes

**1. Application emits signals**  
Your app exposes `/metrics` (Prometheus format) and sends errors to Sentry on every request. Latency histograms, error counters, DB pool gauges — all automatic.

**2. Grafana evaluates, alerts fire**  
Grafana Cloud runs PromQL alert rules continuously. When p95 latency crosses 2s, or error rate exceeds 5%, or DB pool hits 80% — an alert fires and POSTs to 3AM's webhook.

**3. 3AM receives, deduplicates, creates incident**  
The webhook accepts Grafana's payload. 3AM deduplicates by `alertname + service` within a 5-minute window — so a flapping alert doesn't create multiple incidents. One incident = `INC-0001`, `INC-0002`, etc.

**4. TrueForge session starts, agent investigates**  
3AM calls TrueForge SDK: `sessions.create({ agent: "three-am-investigator" })` → `createTurnStream()`. The agent now has a dedicated session for this incident.

**5. Agent queries both systems, correlates**  
The agent uses **Grafana MCP** to query: "What's the p95 latency trend? DB pool waiting? Error rate?"  
It uses **Sentry MCP** to query: "What exceptions spiked? Stack traces? Affected endpoints?"  
The LLM correlates: *latency spike + pool exhaustion + pg_advisory_lock timeouts = DB lock contention*

**6. Structured RCA generated**  
Output is forced JSON with: summary, timeline, root cause (facts separated from hypotheses), evidence table with queries, confidence score, mitigation steps.

**7. Delivered to humans**  
Slack gets a 3-line summary with a link. Notion gets the full investigation with timeline and evidence. Engineer opens Notion, understands the issue in 30 seconds.

## What the RCA Looks Like

```markdown
# INC-0001 — Database Pool Exhaustion

## Summary
Blog API at 100% error rate due to database connection pool exhaustion.

## Timeline
- 03:12:00 — Alert fired: DbPoolExhausted
- 03:12:05 — INC-0001 created, TrueForge session started
- 03:12:30 — RCA complete

## Affected Service
`blog` (Express API)

## Root Cause
**Observed Fact:** `db_pool_waiting` spiked to 18/20 connections waiting  
**Observed Fact:** Sentry shows 247 `pg_advisory_lock` timeout errors in 2 minutes  
**Hypothesis:** Chaos endpoint `/chaos/db-lock` holds advisory lock + exhausts pool

## Evidence
| Source | Query | Result |
|--------|-------|--------|
| Grafana | `max(db_pool_waiting) by (instance)` | 18 waiting |
| Sentry | `issue.type:exception pg_advisory_lock` | 247 events |
| Grafana | `rate(http_requests_total{status=~"5.."}[1m])` | 100% error rate |

## Confidence: 95%

## Recommended Mitigation
1. Immediate: POST `/chaos/stop` to release locks
2. Short-term: Add query timeout + pool monitoring alert
3. Long-term: Implement circuit breaker for DB calls
```

## Architecture at a Glance

| Layer | What It Does | Technology |
|-------|--------------|------------|
| **Application** | Demo production service with full instrumentation | Express, Postgres, prom-client, Sentry SDK |
| **Metrics** | Collects `/metrics`, stores in Grafana Cloud, evaluates alerts | Grafana Alloy → Grafana Cloud (managed Prometheus) |
| **Errors** | Captures exceptions, stack traces, traces automatically | Sentry Cloud |
| **Incident Ingestion** | Receives Grafana webhooks, deduplicates, creates incidents | 3AM Express API (`:3001`) |
| **Agent Runtime** | Runs agent sessions, manages MCP tools, executes LLM | TrueForge (`@truefoundry/trueforge`) |
| **Investigation** | Queries Grafana + Sentry via MCP, correlates, outputs RCA | 3AM Agent (Grafana MCP + Sentry MCP + LLM) |
| **Notifications** | Delivers RCA to Slack (summary) + Notion (full) | Slack API + Notion API |

### Key Design Principles

- **TrueForge owns the agent** — sessions, MCP tools, model execution, context, lifecycle
- **3AM owns the incident workflow** — webhook, dedupe, incident lifecycle, notifications
- **One TrueForge session per incident** — clean mapping `INC-xxxx` ↔ `session.id`
- **MCP servers on TrueForge** — Grafana MCP for metrics, Sentry MCP for errors
- **Cloud-first observability** — Grafana Cloud + Sentry Cloud (local scraper only)

## Quick Start

### Prerequisites
- Docker + Docker Compose
- `.env` file with credentials
- OpenAI API key (configured in TrueForge UI)

### One-Command Demo

```bash
git clone <repo> && cd 3AM
cp .env.example .env
# Edit .env with your credentials

docker compose up --build -d
```

**Open these for the demo:**
- Admin panel: http://localhost:3000/admin
- TrueForge UI: http://localhost:8791
- 3AM health: http://localhost:3001/healthz
- Grafana dashboard: your Grafana Cloud URL

### 60-Second Demo Flow

1. **Start traffic** — Admin panel → "Start Normal Traffic"
2. **Verify healthy** — Grafana shows flat latency, 0% errors
3. **Break it** — Admin panel → "DB Lock" (or Latency, Error Rate, etc.)
4. **Watch** — Grafana spikes → Alert fires → 3AM webhook hit → TrueForge session opens
5. **Get RCA** — Check Slack (summary) + Notion (full details)
6. **Recover** — Admin panel → "Stop All" → Metrics normalize → Incident auto-closes

### Manual Trigger (Fallback)

```bash
curl -X POST http://localhost:3001/trigger \
  -H 'Content-Type: application/json' \
  -d '{"alertname":"HighErrorRate","service":"blog"}'

curl http://localhost:3001/incidents/INC-0001 | python3 -m json.tool
```

## Environment Variables

Create `.env` from `.env.example`:

```bash
# Application
DATABASE_URL=postgres://user:pass@host:5432/db      # Neon Postgres (unpooled)
SENTRY_DSN=https://xxx@o1.ingest.sentry.io/xxx

# 3AM Incident Response
TRUEFORGE_BASE_URL=http://host.docker.internal:8791 # TrueForge on host
TRUEFORGE_AGENT_NAME=three-am-investigator
TRUEFORGE_MODEL=openai/gpt-4o                       # Model FQN from TrueForge UI
THREE_AM_PORT=3001

# Notifications (optional for demo)
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_CHANNEL_ID=Cxxx
NOTION_TOKEN=ntn_xxx
NOTION_DATABASE_ID=xxx

# Metrics → Grafana Cloud (required)
GCLOUD_HOSTED_METRICS_URL=https://prometheus-xxx.grafana.net/api/prom/push
GCLOUD_HOSTED_METRICS_ID=xxx
GCLOUD_RW_API_KEY=glc_xxx
```

**TrueForge model setup:** Open http://localhost:8791 → Settings → Models → Add your OpenAI/Anthropic key → Copy model FQN → Set as `TRUEFORGE_MODEL`.

## Chaos Scenarios (Built into Admin Panel)

| Scenario | What It Does | Grafana Signal | Sentry Signal |
|----------|--------------|----------------|---------------|
| **DB Lock** | Holds PG advisory lock + exhausts connection pool | `db_pool_waiting` ↑, latency ↑ | `pg_advisory_lock` timeouts |
| **Latency** | Injects 800ms–2s delay on `/posts` | p95 latency ↑ | Timeout errors |
| **Traffic Spike** | 10x RPS background load generator | RPS ↑, latency ↑ | Rate limit errors |
| **Retry Storm** | Downstream retry loop with backoff failure | Latency ↑, error rate ↑ | Retry exhaustion errors |
| **Dependency Fail** | Fake external service returns 500 | Error rate ↑ | 502/504 errors |
| **Error Rate** | Random 500s on blog routes | Error rate ↑ | 500 exceptions |
| **Stop All** | Resets all flags, kills background loops | Metrics recover | Errors stop |

Each scenario moves **both** Grafana metrics **and** emits Sentry errors — so the agent always has correlated evidence.

## Project Structure (Simplified)

```
3AM/
├── AGENTS.md              # Agent spec & workflow (source of truth)
├── ARCHITECTURE.md        # Detailed architecture diagrams
├── RUN.md                 # All run commands
├── docker-compose.yml     # Blog + Alloy + 3AM (TrueForge runs on host)
├── package.json           # pnpm workspace root
├── .env.example
│
├── apps/
│   ├── blog/              # Demo production app
│   │   ├── src/
│   │   │   ├── index.js          # Express + routes + /metrics + /healthz
│   │   │   ├── db.js             # pg pool + gauges
│   │   │   ├── metrics.js        # Prometheus histograms/counters
│   │   │   ├── sentry.js         # Sentry initialization
│   │   │   ├── chaos/            # 6 chaos scenarios + stop
│   │   │   ├── routes/
│   │   │   └── public/admin.html # Admin panel (zero-dep vanilla JS)
│   │   └── Dockerfile
│   │
│   └── 3am/               # Incident-response workflow
│       ├── src/
│       │   ├── index.js          # Webhook + incident API
│       │   ├── incidents.js      # Create + in-memory dedupe
│       │   ├── trueforge.js      # TrueForge SDK client
│       │   ├── investigate.js    # Build prompt, parse RCA
│       │   └── notify/           # Slack + Notion + RCA template
│       └── Dockerfile
│
├── infra/
│   └── alloy/config.alloy         # Scrapes blog → Grafana Cloud
│
└── trueforge/
    ├── agent.json                 # 3AM agent spec
    ├── mcp.json                   # Grafana + Sentry MCP configs
    └── README.md                  # TrueForge setup guide
```

## Development (Host-Direct)

```bash
# Terminal 1: TrueForge (Neon + Upstash)
DATABASE_URL=... REDIS_URL=... PUBLIC_BASE_URL=http://localhost:8791 \
npx @truefoundry/trueforge --port 8791

# Terminal 2: Blog (against Neon)
cd apps/blog && pnpm dev

# Terminal 3: Alloy (scrapes local blog)
cd infra/alloy && docker run -p 12345:12345 -v $(pwd)/config.alloy:/etc/alloy/config.alloy:ro \
  -e GCLOUD_HOSTED_METRICS_URL -e GCLOUD_HOSTED_METRICS_ID -e GCLOUD_RW_API_KEY \
  grafana/alloy:v1.7.4 run --server.http.listen-addr=0.0.0.0:12345 /etc/alloy/config.alloy

# Terminal 4: 3AM (against TrueForge :8791)
cd apps/3am && pnpm dev
```

## Credits

- **TrueForge** — Agent harness ([trueforge.dev](https://trueforge.dev))
- **Grafana** — Metrics & alerting
- **Sentry** — Error tracking
- **OpenAI** — LLM reasoning

## License

MIT — Hackathon project, use freely.

Thank you TrueForge Team for the harness really cool! 

This is going to be actual on call agents at fampay - which will handling thousands of alert everyday : )