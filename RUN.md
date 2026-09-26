# Run Commands — 3AM Full Stack

## Prerequisites
- `.env` filled (Neon URLs, Grafana Cloud token, Upstash Redis, Sentry DSN, OpenAI key)
- `.env.staging` if deploying to Neon DBs
- Docker + Docker Compose
- Node 22+ (for host scripts)

---

## 1. One-Command Full Stack (Recommended for Demo)

```bash
# From repo root
docker compose up --build -d
```

**Services started:**
| Service | URL | Purpose |
|---------|-----|---------|
| Blog | http://localhost:3000 | App + `/metrics` + `/admin` |
| Alloy | http://localhost:12345 | Scrapes blog → Grafana Cloud |
| TrueForge | http://localhost:8791 | Agent runtime + UI |
| 3AM | http://localhost:3001 | Webhook + incidents |

**Stop:**
```bash
docker compose down
```

---

## 2. Individual Services (for Debugging)

### Blog + Alloy only
```bash
docker compose up -d blog alloy
```
- Blog: http://localhost:3000
- Alloy UI: http://localhost:12345

### TrueForge only (hosted mode)
```bash
# Uses .env values: TRUEFORGE_DATABASE_URL, REDIS_URL, PUBLIC_BASE_URL
docker compose up -d trueforge
```
- UI: http://localhost:8791

### 3AM only
```bash
# Requires TrueForge already running on :8791
docker compose up -d 3am
```
- API: http://localhost:3001

---

## 3. Host-Direct (No Docker) — For Development

### TrueForge (hosted mode on Neon + Upstash)
```bash
# Terminal 1 — keep running
DATABASE_URL="postgresql://neondb_owner:npg_Ud5xC9WmTaAb@ep-curly-tree-b331alwh.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require" \
REDIS_URL="rediss://default:gQAAAAAABJfiAAIgcDI5MTZhMWU2ZTMxYzM0NzJiYWExMWQyZDg5YWI5MjdmZA@civil-aardvark-301026.upstash.io:6379" \
PUBLIC_BASE_URL="http://localhost:8791" \
TRUEFORGE_API_KEY="test-key-$(openssl rand -hex 16)" \
AUTH_ENABLED="false" \
SERVER_PORT=8791 \
HOST=0.0.0.0 \
STANDALONE="false" \
npx @truefoundry/trueforge --port 8791
```

### Blog (host, against Neon)
```bash
# Terminal 2
cd apps/blog
ENV_FILE=../../.env.staging pnpm dev
# or: pnpm dev  (uses .env local)
```
- Runs on :3000, connects to Neon Postgres

### Alloy (host, against local blog)
```bash
# Terminal 3
cd infra/alloy
docker run --rm -p 12345:12345 \
  -v $(pwd)/config.alloy:/etc/alloy/config.alloy:ro \
  -e GCLOUD_HOSTED_METRICS_URL -e GCLOUD_HOSTED_METRICS_ID -e GCLOUD_RW_API_KEY \
  grafana/alloy:v1.7.4 run --server.http.listen-addr=0.0.0.0:12345 /etc/alloy/config.alloy
```

### 3AM (host, against TrueForge :8791)
```bash
# Terminal 4
cd apps/3am
pnpm dev
```
- Runs on :3001, calls TrueForge at http://localhost:8791

---

## 4. Verify Commands

```bash
# Blog health
curl http://localhost:3000/healthz

# Blog posts (seeded)
curl http://localhost:3000/posts

# Metrics (Prometheus format)
curl http://localhost:3000/metrics | head -20

# Admin panel
open http://localhost:3000/admin

# Alloy targets
curl http://localhost:12345/api/v0/web/targets

# TrueForge UI
open http://localhost:8791

# TrueForge agent verify
node apps/3am/scripts/verify-agent.mjs

# 3AM health
curl http://localhost:3001/healthz

# Trigger fake incident
curl -X POST http://localhost:3001/trigger \
  -H 'Content-Type: application/json' \
  -d '{"alertname":"HighErrorRate","service":"blog"}'

# Check incident
curl http://localhost:3001/incidents/INC-0001 | python3 -m json.tool

# Grafana Cloud dashboard
open https://fearlessavocado2394.grafana.net/d/blog-overview/blog-overview
```

---

## 5. Common Issues

| Problem | Fix |
|---------|-----|
| `host.docker.internal` not resolving | Use `extra_hosts: host-gateway` in compose (already set) |
| TrueForge can't connect to Neon | Use **unpooled** Neon URL (no `-pooler` in host) |
| Alloy remote_write 401 | Check `GCLOUD_RW_API_KEY` in `.env` |
| Sentry MCP `auth_required` | Click **Connect** in TrueForge UI → Settings → Connectors |
| 3AM `fetch failed` to TrueForge | Ensure TrueForge runs on `0.0.0.0:8791`, not `127.0.0.1` |
| Port 3000/3001/8791 busy | `fuser -k 3000/tcp 3001/tcp 8791/tcp` |

---

## 6. Quick Demo Flow

```bash
# 1. Start everything
docker compose up -d

# 2. Open admin panel, start traffic
open http://localhost:3000/admin
# Click "Start Normal Traffic"

# 3. Show Grafana healthy
open https://fearlessavocado2394.grafana.net/d/blog-overview/blog-overview

# 4. Trigger chaos
# In admin panel: Click "DB Lock" (or Latency, Error Rate, etc.)

# 5. Watch alert fire → 3AM webhook → TrueForge session → RCA
# Check incident:
curl http://localhost:3001/incidents/INC-0001 | python3 -m json.tool

# 6. Stop chaos
# In admin panel: Click "Stop All"
```