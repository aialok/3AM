# 3AM — Autonomous Incident Response

> **When production breaks at 3AM, 3AM is already awake.**

3AM is an autonomous incident-response agent that automatically investigates production incidents before engineers start debugging. Built on [TrueForge](https://trueforge.dev) (open-source agent harness), it correlates metrics from **Grafana** and errors from **Sentry** to generate a Root Cause Analysis (RCA) — then posts it to **Slack** and **Notion**.

---

## The Problem

```
Incident happens at 3AM
       ↓
Engineer wakes up, opens 5 tabs
       ↓
Grafana dashboard (metrics) → Sentry (errors) → Logs → Traces
       ↓
Correlate manually → Hypothesize → Test → Fix
       ↓
45 minutes later: "It was DB pool exhaustion from a retry storm"
```

**3AM automates the investigation** — you wake up to a complete RCA with evidence.

---

## How It Works (End-to-End)

```mermaid
flowchart TD
    %% Styles
    classDef app fill:#e8f4fd,stroke:#1a73e8,stroke-width:2px
    classDef obs fill:#fef3c7,stroke:#f59e0b,stroke-width:2px
    classDef ai fill:#ecfdf5,stroke:#10b981,stroke-width:2px
    classDef notify fill:#fce7f3,stroke:#ec4899,stroke-width:2px
    classDef sim fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,stroke-dasharray: 5 5

    %% Components
    CHAOS[("💥 Chaos Trigger\nAdmin Panel")]
    BLOG["📝 Blog App\nExpress + Postgres\n:3000"]
    ALLOY["📊 Grafana Alloy\nScrapes /metrics"]
    GRAFANA["☁️ Grafana Cloud\nMetrics + Alerts"]
    SENTRY["☁️ Sentry Cloud\nErrors + Traces"]
    
    WEBHOOK["🔔 3AM Webhook\n:3001\n/webhook/grafana"]
    DEDUPE["🔍 Deduplicate\nalertname + service"]
    INCIDENT["📋 Create Incident\nINC-xxxx"]
    
    TF["🤖 TrueForge Server\n:8791\nAgent Runtime"]
    AGENT["🧠 3AM Agent\n• Grafana MCP\n• Sentry MCP\n• LLM Reasoning"]
    
    GMCP["📈 Grafana MCP\nQuery metrics"]
    SMCP["🐛 Sentry MCP\nQuery exceptions"]
    
    RCA["📄 Structured RCA\nFacts vs Hypotheses"]
    SLACK["💬 Slack\nConcise summary"]
    NOTION["📓 Notion\nFull RCA + timeline"]

    %% Flow
    CHAOS -->|POST /chaos/*| BLOG
    BLOG -->|/metrics| ALLOY
    ALLOY -->|remote_write| GRAFANA
    BLOG -.->|@sentry/node| SENTRY
    
    GRAFANA -->|Alert webhook\n(HighLatency, HighErrorRate\nDbPoolExhausted, TrafficSpike)| WEBHOOK
    
    WEBHOOK --> DEDUPE --> INCIDENT
    INCIDENT -->|TrueForge SDK\nsessions.create()| TF
    TF --> AGENT
    
    AGENT -->|Query metrics| GMCP
    GMCP --> GRAFANA
    AGENT -->|Query errors| SMCP
    SMCP --> SENTRY
    
    AGENT -.->|Correlate + Reason| RCA
    RCA --> TF --> INCIDENT
    
    INCIDENT -->|Phase 6| SLACK
    INCIDENT -->|Phase 6| NOTION
```

### Incident Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant User as Engineer
    participant Admin as Admin Panel
    participant Blog as Blog App
    participant GC as Grafana Cloud
    participant 3AM as 3AM API
    participant TF as TrueForge
    participant GMCP as Grafana MCP
    participant SMCP as Sentry MCP

    User->>Admin: Click "DB Lock"
    Admin->>Blog: POST /chaos/db-lock
    Blog->>Blog: Holds PG advisory lock
    Blog->>GC: Metrics spike (latency↑, pool↑)
    GC->>GC: Alert fires (DbPoolExhausted)
    GC->>3AM: Webhook POST /webhook/grafana
    3AM->>3AM: Dedupe → create INC-0001
    3AM->>TF: sessions.create(agent: three-am-investigator)
    TF->>TF: New session, load agent
    loop Investigation
        TF->>GMCP: Query latency, pool, errors
        TF->>SMCP: Query exceptions, stack traces
        TF->>TF: LLM correlates evidence
    end
    TF-->>3AM: turn.done with RCA JSON
    3AM->>3AM: Parse, store on incident
    3AM->>Slack: Concise summary + link
    3AM->>Notion: Full RCA + timeline + evidence
    User->>Admin: Click "Stop All"
    Admin->>Blog: POST /chaos/stop
    Blog->>GC: Metrics recover
    GC->>3AM: Resolved webhook → closes INC
```

---

## What 3AM Produces (RCA)

```markdown
# INC-0001 — Database Pool Exhaustion

## Summary
Blog API experiencing 100% error rate due to database connection pool exhaustion.

## Timeline
- **2024-01-15 03:12:00** — Alert fired: DbPoolExhausted
- **2024-01-15 03:12:05** — INC-0001 created, TrueForge session started
- **2024-01-15 03:12:30** — RCA complete

## Affected Service
`blog` (Express API on port 3000)

## Root Cause
**Observed Fact:** `db_pool_waiting` gauge spiked to 18/20 connections waiting.
**Observed Fact:** Sentry shows 247 `pg_advisory_lock` timeout errors in 2 min.
**Hypothesis:** Chaos endpoint `/chaos/db-lock` holds advisory lock + exhausts pool.

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

---

## Architecture

### Components

| Layer | Component | Tech | Purpose |
|-------|-----------|------|---------|
| **App** | Blog | Express + Postgres + prom-client + Sentry | Demo production service |
| **Collect** | Alloy | Grafana Alloy | Scrape `/metrics` → Grafana Cloud |
| **Observe** | Grafana Cloud | Managed Prometheus + Dashboards + Alerts | Metrics storage, alerting |
| **Errors** | Sentry Cloud | Managed Sentry | Exceptions, traces, logs |
| **Trigger** | 3AM Webhook | Express `:3001` | Receive Grafana alerts |
| **Dedupe** | 3AM Logic | In-memory (5-min window) | `alertname + service` → single INC |
| **Reason** | TrueForge | `@truefoundry/trueforge` | Agent runtime, MCP, LLM |
| **Investigate** | 3AM Agent | Grafana MCP + Sentry MCP + LLM | Query, correlate, generate RCA |
| **Notify** | 3AM Notify | Slack API + Notion API | Deliver RCA to humans |

### Key Design Decisions

- **TrueForge owns the agent runtime** — sessions, MCP tools, model execution, context
- **3AM owns the incident workflow** — dedupe, webhook, incident lifecycle, notifications
- **One TrueForge session per incident** — `INC-xxxx` ↔ `session.id` mapping
- **MCP servers on TrueForge** — Grafana MCP (metrics) + Sentry MCP (errors)
- **Cloud-first observability** — Grafana Cloud + Sentry Cloud (local Alloy scrapes only)

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- `.env` file with credentials (see [Environment](#environment))
- OpenAI API key (for TrueForge model)

### One-Command Demo

```bash
# 1. Clone & configure
git clone <repo> && cd 3AM
cp .env.example .env
# Edit .env with your credentials

# 2. Start everything
docker compose up --build -d

# 3. Open services
open http://localhost:3000/admin      # Admin panel (traffic + chaos)
open http://localhost:8791            # TrueForge UI
open http://localhost:3001/healthz    # 3AM health
open https://<your-org>.grafana.net/d/blog-overview  # Grafana dashboard
```

### Demo Flow (60 seconds)

1. **Start traffic** — Admin panel → "Start Normal Traffic"
2. **Verify healthy** — Grafana dashboard shows flat latency, 0% errors
3. **Break it** — Admin panel → "DB Lock" (or Latency, Error Rate, etc.)
4. **Watch** — Grafana spikes → Alert fires → 3AM webhook hit → TrueForge session opens
5. **Get RCA** — Check Slack (summary) + Notion (full details)
6. **Recover** — Admin panel → "Stop All" → Metrics normalize → Incident auto-closes

### Manual Trigger (Fallback)

```bash
curl -X POST http://localhost:3001/trigger \
  -H 'Content-Type: application/json' \
  -d '{"alertname":"HighErrorRate","service":"blog"}'
```

Check incident:
```bash
curl http://localhost:3001/incidents/INC-0001 | python3 -m json.tool
```

---

## Environment

Create `.env` from `.env.example`:

```bash
# Blog (demo app)
DATABASE_URL=postgres://user:pass@host:5432/db      # Neon Postgres (unpooled)
SENTRY_DSN=https://xxx@o1.ingest.sentry.io/xxx      # Sentry DSN

# 3AM (incident response)
TRUEFORGE_BASE_URL=http://host.docker.internal:8791 # TrueForge on host
TRUEFORGE_AGENT_NAME=three-am-investigator
TRUEFORGE_MODEL=openai/gpt-4o                       # Model FQN from TrueForge UI
THREE_AM_PORT=3001

# Notifications (Phase 6 - optional for demo)
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_CHANNEL_ID=Cxxx
NOTION_TOKEN=ntn_xxx
NOTION_DATABASE_ID=xxx

# Alloy → Grafana Cloud (required)
GCLOUD_HOSTED_METRICS_URL=https://prometheus-xxx.grafana.net/api/prom/push
GCLOUD_HOSTED_METRICS_ID=xxx
GCLOUD_RW_API_KEY=glc_xxx
```

**TrueForge model setup:** Open http://localhost:8791 → Settings → Models → Add your OpenAI/Anthropic key → Note the model FQN → Set as `TRUEFORGE_MODEL`.

---

## Project Structure

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
│   │   │   ├── metrics.js        # prom-client histograms/counters
│   │   │   ├── sentry.js         # @sentry/node init
│   │   │   ├── chaos/            # 6 chaos scenarios + stop
│   │   │   ├── routes/
│   │   │   │   ├── posts.js      # Blog CRUD
│   │   │   │   └── admin.js      # Traffic sim + chaos triggers
│   │   │   └── public/admin.html # Admin panel (zero-dep vanilla JS)
│   │   └── Dockerfile
│   │
│   └── 3am/               # Incident-response workflow
│       ├── src/
│       │   ├── index.js          # Express: /webhook/grafana, /trigger, /incidents
│       │   ├── incidents.js      # Incident create + in-memory dedupe
│       │   ├── trueforge.js      # TrueForge SDK client
│       │   ├── investigate.js    # Build prompt, parse RCA from turn events
│       │   ├── config.js         # Env validation
│       │   └── notify/           # Slack + Notion + RCA markdown template
│       └── Dockerfile
│
├── infra/
│   ├── alloy/config.alloy         # Scrapes blog:/metrics → remote_write
│   ├── prometheus/                # Reference (not used in compose)
│   │   ├── prometheus.yml
│   │   └── alert.rules.yml        # HighLatency, HighErrorRate, DbPoolExhausted, TrafficSpike
│   ├── grafana/provisioning/      # Reference (Grafana Cloud owns dashboards/alerts)
│   └── postgres/init.sql          # Reference (Neon used instead)
│
└── trueforge/
    ├── agent.json                 # 3AM agent spec (model, instructions, MCPs, output schema)
    ├── mcp.json                   # Grafana + Sentry MCP connector configs
    └── README.md                  # TrueForge setup guide
```

---

## Chaos Scenarios (Admin Panel)

| Scenario | Endpoint | Effect | Grafana Signal | Sentry Signal |
|----------|----------|--------|----------------|---------------|
| **DB Lock** | `POST /chaos/db-lock` | Advisory lock + pool exhaustion | `db_pool_waiting` ↑, latency ↑ | `pg_advisory_lock` timeouts |
| **Latency** | `POST /chaos/latency` | 800ms–2s `pg_sleep` on `/posts` | p95 latency ↑ | Timeout errors |
| **Traffic Spike** | `POST /chaos/traffic-spike` | 10x RPS background loop | RPS ↑, latency ↑ | Rate limit errors |
| **Retry Storm** | `POST /chaos/retry-storm` | Downstream retry loop with backoff fail | Latency ↑, error rate ↑ | Retry exhaustion errors |
| **Dependency Fail** | `POST /chaos/dependency-fail` | Fake external service returns 500 | Error rate ↑ | 502/504 errors |
| **Error Rate** | `POST /chaos/error-rate` | Random 500s on blog routes | Error rate ↑ | 500 exceptions |
| **Stop All** | `POST /chaos/stop` | Resets all flags, kills loops | Metrics recover | Errors stop |

---

## Development

### Host-Direct (No Docker)

```bash
# Terminal 1: TrueForge (uses Neon + Upstash)
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

### Verify Agent

```bash
node apps/3am/scripts/verify-agent.mjs
```

---

## Credits

- **TrueForge** — Agent harness ([trueforge.dev](https://trueforge.dev))
- **Grafana Alloy** — Metrics collection
- **Sentry** — Error tracking
- **OpenAI** — LLM reasoning

---

## License

MIT — Hackathon project, use freely.