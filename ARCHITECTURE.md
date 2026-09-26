# 3AM — End-to-End Architecture

```mermaid
flowchart TD
    %% Styles
    classDef cloud fill:#e8f4fd,stroke:#1a73e8,stroke-width:2px,color:#1a73e8
    classDef local fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e
    classDef process fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#065f46
    classDef data fill:#fce7f3,stroke:#ec4899,stroke-width:2px,color:#9d174d
    classDef ext fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,stroke-dasharray: 5 5,color:#374151

    %% ========== EXTERNAL / CLOUD SERVICES ==========
    subgraph CLOUD["☁️  Cloud Services (Managed)"]
        direction TB
        
        subgraph OBS["Observability"]
            GCLOUD["Grafana Cloud\n(Metrics + Dashboards + Alerts)"]
            SENTRY["Sentry Cloud\n(Errors + Traces + Logs)"]
        end
        
        subgraph DATA["Data & State"]
            NEON_PG[("Neon Postgres\nTrueForge DB + Blog DB")]
            UPSTASH[("Upstash Redis\nTrueForge Peering")]
        end
        
        subgraph AI["AI / LLM"]
            OPENAI["OpenAI API\n(gpt-5-6-luna)"]
        end
        
        subgraph COMMS["Notifications"]
            SLACK["Slack\n#incidents"]
            NOTION["Notion\nRCA Database"]
        end
        
        MCP_GRAFANA["Grafana MCP\nmcp.grafana.com"]
        MCP_SENTRY["Sentry MCP\nmcp.sentry.dev"]
    end

    %% ========== LOCAL MACHINE (Laptop / Stage) ==========
    subgraph LOCAL["💻  Local Machine (Docker Compose)"]
        direction TB
        
        subgraph APP["Application"]
            BLOG["Blog App\nExpress + Postgres\n:3000"]
            ALLOY["Grafana Alloy\nScrapes /metrics → remote_write"]
        end
        
        subgraph TF["TrueForge Harness (Hosted Mode)"]
            TF_SERVER["TrueForge Server\n:8791\n• Agent loop\n• Session mgmt\n• MCP exec\n• Model calls"]
            TF_UI["TrueForge UI\nBuild Agent / Settings / Sessions"]
        end
        
        subgraph THREEAM["3AM Incident Response"]
            THREEAM_API["3AM API\n:3001\n• /webhook/grafana\n• /trigger\n• /incidents"]
            THREEAM_LOGIC["Incident Logic\n• Dedupe\n• Investigate\n• Parse RCA"]
        end
        
        ADMIN["Admin Panel\n/blog/admin\nChaos triggers"]
    end

    %% ========== CONNECTIONS ==========
    
    %% Blog -> Alloy -> Grafana Cloud
    BLOG -->|"/metrics (Prometheus)"| ALLOY
    ALLOY -->|"remote_write (HTTPS)"| GCLOUD
    
    %% Blog -> Neon (Blog DB)
    BLOG -->|"DATABASE_URL (Neon)"| NEON_PG
    
    %% Blog -> Sentry (errors/traces)
    BLOG -.->|"@sentry/node (DSN)"| SENTRY
    
    %% Grafana Alerts -> 3AM
    GCLOUD -->|"Alert webhook (POST /webhook/grafana)"| THREEAM_API
    
    %% 3AM -> TrueForge
    THREEAM_API -->|"TrueForge SDK (HTTP + SSE)\nsessions.create / createTurn"| TF_SERVER
    
    %% TrueForge internal
    TF_SERVER -->|"Reads agent spec, MCP config"| NEON_PG
    TF_SERVER -->|"Redis peering"| UPSTASH
    TF_SERVER -->|"Model inference"| OPENAI
    TF_SERVER -->|"MCP calls (tools)"| MCP_GRAFANA
    TF_SERVER -->|"MCP calls (tools)"| MCP_SENTRY
    
    %% MCP -> Cloud
    MCP_GRAFANA -.->|"Queries metrics"| GCLOUD
    MCP_SENTRY -.->|"Queries errors/traces"| SENTRY
    
    %% TrueForge UI
    TF_UI -.->|"Configure models, MCP, agents"| TF_SERVER
    
    %% Admin -> Blog
    ADMIN -->|"POST /chaos/*\nGET /admin/status"| BLOG
    
    %% 3AM -> Notifications
    THREEAM_LOGIC -.->|"RCA markdown"| SLACK
    THREEAM_LOGIC -.->|"RCA markdown"| NOTION
    
    %% TrueForge saves sessions
    TF_SERVER -.->|"Session history"| NEON_PG
    
    %% Admin -> Grafana
    ADMIN -.->|"Link to dashboard"| GCLOUD
```

---

## Component Responsibilities

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Trigger** | Grafana Cloud | Evaluates PromQL alerts → fires webhook to 3AM |
| **Ingest** | 3AM API (`:3001`) | Receives webhook, deduplicates, creates `INC-xxxx` |
| **Orchestrate** | 3AM Logic | Calls TrueForge SDK → opens session → streams investigation |
| **Reason** | TrueForge Server (`:8791`) | Runs agent loop: plans → calls LLM → executes MCP tools → returns RCA |
| **Investigate** | Agent (via TrueForge) | Queries **Grafana MCP** (metrics) + **Sentry MCP** (errors) → correlates → outputs structured RCA JSON |
| **Notify** | 3AM (Phase 6) | Posts RCA to Slack + Notion |
| **Simulate** | Admin Panel + Chaos | Generates realistic incidents (DB lock, latency, traffic spike, etc.) |
| **Observe** | Blog + Alloy + Grafana Cloud | App exposes `/metrics` → Alloy scrapes → Cloud stores → dashboards + alerts |
| **Errors/Traces** | Blog + Sentry SDK | Auto-captures exceptions, spans, logs → Sentry Cloud |

---

## Data Flow (Incident Lifecycle)

```mermaid
sequenceDiagram
    autonumber
    actor User as Engineer
    participant Admin as Admin Panel
    participant Blog as Blog App
    participant Alloy as Alloy
    participant GC as Grafana Cloud
    participant 3AM as 3AM API
    participant TF as TrueForge
    participant GMCP as Grafana MCP
    participant SMCP as Sentry MCP
    participant Slack as Slack
    participant Notion as Notion

    User->>Admin: Click "DB Lock" chaos
    Admin->>Blog: POST /chaos/db-lock
    Blog->>Blog: Holds PG advisory lock
    Blog->>Alloy: /metrics (latency↑, pool_waiting↑)
    Alloy->>GC: remote_write
    GC->>GC: Alert rule fires (DbPoolExhausted)
    GC->>3AM: Webhook POST /webhook/grafana
    3AM->>3AM: Dedupe → create INC-0001
    3AM->>TF: sessions.create(agent: three-am-investigator)
    TF->>TF: New session, load agent spec
    loop Investigation (multiple turns)
        TF->>GMCP: Query latency, error rate, pool
        GMCP->>GC: PromQL queries
        TF->>SMCP: Query exceptions, stack traces
        SMCP->>SENTRY: Sentry API
        TF->>OPENAI: Model reasoning (correlate)
    end
    TF-->>3AM: turn.done with RCA JSON
    3AM->>3AM: Parse RCA, store on incident
    3AM->>Slack: Post concise summary + link
    3AM->>Notion: Create page with full RCA
    User->>Admin: Click "Stop All"
    Admin->>Blog: POST /chaos/stop
    Blog->>GC: Metrics recover
    GC->>3AM: Resolved webhook → closes INC
```

---

## Ports & Endpoints (Local)

| Service | Port | Key Endpoints |
|---------|------|---------------|
| Blog | 3000 | `GET /posts`, `GET /metrics`, `POST /chaos/*`, `GET /admin` |
| Alloy | 12345 | Debug UI, component health |
| TrueForge | 8791 | UI, `POST /api/v1/sessions`, `POST /api/v1/sessions/:id/turns` |
| 3AM | 3001 | `POST /webhook/grafana`, `POST /trigger`, `GET /incidents/:id` |
| Grafana Cloud | 443 | Dashboards, alerts, contact points |
| Sentry Cloud | 443 | Issues, Performance, Logs |

---

## Credentials (All via `.env` — Nothing Hardcoded)

| Variable | Used By | Purpose |
|----------|---------|---------|
| `DATABASE_URL` (Neon blog) | Blog | Primary Postgres |
| `TRUEFORGE_DATABASE_URL` (Neon) | TrueForge | Agent DB |
| `REDIS_URL` (Upstash) | TrueForge | Replica peering |
| `SENTRY_DSN` | Blog | Error/trace capture |
| `GCLOUD_*` | Alloy | Grafana Cloud remote_write |
| `GRAFANA_CLOUD_TOKEN` | TrueForge MCP | Grafana MCP header auth |
| `OPENAI_API_KEY` | TrueForge | Model inference |
| `SLACK_BOT_TOKEN`, `NOTION_TOKEN` | 3AM (Phase 6) | Notifications |

---

## Demo Script (60 seconds)

1. **Open** `http://localhost:3000/admin` → "Start Normal Traffic"
2. **Show** `http://fearlessavocado2394.grafana.net/d/blog-overview` — healthy
3. **Click** "DB Lock" in admin → Grafana p95 spikes, pool waiting ↑
4. **Alert fires** → webhook hits 3AM → `INC-0001` created
5. **TrueForge session opens** → agent queries Grafana MCP + Sentry MCP
6. **RCA lands** → Slack (summary) + Notion (full)
7. **Click** "Stop All" → metrics recover → incident auto-closes