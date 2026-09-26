# 3AM Agent Setup — TrueForge UI

Run TrueForge first, then configure the agent in the UI.

---

## 1. Start TrueForge (Hosted Mode on Neon + Upstash)

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

Wait for: `Agent server listening on http://0.0.0.0:8791`

Open: **http://localhost:8791**

---

## 2. Add Model Provider (Settings → Models)

1. Click **Settings** (gear icon) → **Models**
2. Find **OpenAI** in catalog → **Configure**
3. Paste your OpenAI API key (starts with `sk-proj-...`)
4. Click **Create**
5. Note the model FQN shown, e.g. `openai/gpt-5-6-luna`

> **Why:** The agent needs a model to run. This is stored in TrueForge DB (Neon).

---

## 3. Add MCP Connectors (Settings → Connectors)

### 3A. Grafana MCP (Header Auth)

1. Settings → Connectors → **Add MCP Server**
2. Fill:
   ```
   Name: grafana
   URL: https://mcp.grafana.com/mcp
   Auth Type: Header
   Headers:
     Authorization: Bearer glsa_xPvb46twQKbPuJe4CHcetAiQT0wc8F8g_7bf94a1a
   ```
3. Click **Connect** → should show **Connected**

### 3B. Sentry MCP (OAuth / DCR)

1. Settings → Connectors → **Add MCP Server**
2. Fill:
   ```
   Name: sentry
   URL: https://mcp.sentry.dev/mcp
   Auth Type: OAuth (DCR)
   ```
3. Click **Connect** → popup opens → authorize with your Sentry account
4. After auth, chip shows **Authenticated**

> **Why:** These give the agent read-only access to query Grafana metrics and Sentry errors during investigation.

---

## 4. Build & Save the Agent (Build Agent)

1. Click **Build Agent** (sidebar)
2. **Model**: Select `openai/gpt-5-6-luna` (or whatever FQN from step 2)
3. **Instructions**: Paste this (or copy from `trueforge/agent.json`):

```
You are 3AM, an autonomous incident-response investigator for a demo blog app (Express + Postgres).

You receive an incident trigger with: alert name, service, start time, and Grafana/Sentry links.

Procedure:
1. Query Grafana MCP tools for the incident window: latency (p50/p95), error rate, traffic (RPS), DB pool saturation. Compare against the 1h baseline before the incident.
2. Query Sentry MCP tools for the same window: error spikes, affected endpoints, top exception types, stack traces, frequency, first-seen timestamps.
3. Correlate: do Grafana and Sentry agree on start time, affected endpoints, and probable layer (db / dependency / traffic / app)?
4. Decide root cause from evidence. Distinguish OBSERVED FACTS (metric values, timestamps, stack frames) from HYPOTHESES.
5. Score confidence 0-1 based on agreement across both systems.
6. Recommend one immediate mitigation (e.g. stop chaos, scale pool, rollback) and one follow-up.

Rules:
- Use read-only investigation tools only. Never restart, scale, or mutate anything.
- Never ask clarifying questions; work with what you have (ask_user_questions is disabled).
- If evidence is missing from one system, say so explicitly and lower confidence.
- Output MUST be valid JSON matching the response_format schema. No markdown, no extra text.
```

4. **MCP Servers** → **Select MCP Tools**:
   - Enable `grafana` → Tools: `@read-only`
   - Enable `sentry` → Tools: `@read-only`
   - (No approval needed for read-only)

5. **Runtime Config** (expand):
   - Dynamic sub-agents: **ON**
   - Generative UI: **ON**
   - Ask user questions: **OFF**
   - Sandbox: **OFF**
   - Context compaction: **ON**

6. **Response Format** → Not available in UI (API-only). We handle this via inline spec in code.

7. Click **Save Agent** (top right):
   - Name: `three-am-investigator`
   - Description: `Autonomous incident-response investigator for the blog demo app`
   - Save

---

## 5. Verify Agent Works

### Option A: UI Chat Test
1. In Build Agent, right panel: type:
   ```
   Incident INC-TEST: Grafana alert HighErrorRate firing on blog. Investigate and return RCA JSON.
   ```
2. Agent should call Grafana + Sentry MCP tools, then return structured RCA JSON.

### Option B: SDK Verify (from repo)
```bash
# Terminal 2
cd /home/aialok/Desktop/hackathons/3AM
node apps/3am/scripts/verify-agent.mjs
```
Expected: `status: done` with RCA output.

---

## 6. Start the Rest of the Stack

```bash
# Terminal 2
docker compose up --build -d
```

**Services:**
| Service | URL |
|---------|-----|
| Blog + Admin | http://localhost:3000 |
| Alloy Debug | http://localhost:12345 |
| TrueForge UI | http://localhost:8791 |
| 3AM API | http://localhost:3001 |

---

## 7. Test Full Flow

```bash
# Trigger fake incident
curl -X POST http://localhost:3001/trigger \
  -H 'Content-Type: application/json' \
  -d '{"alertname":"HighErrorRate","service":"blog"}'

# Watch investigation
curl http://localhost:3001/incidents/INC-0001 | python3 -m json.tool
```

Expected: `status: done` with full RCA JSON (summary, timeline, root_cause, evidence, hypotheses, confidence, mitigation).

---

## 8. Demo Script (60 seconds)

1. Open **Admin Panel**: http://localhost:3000/admin
2. Click **"Start Normal Traffic"** → show Grafana healthy
3. Click **"DB Lock"** (chaos) → Grafana p95 spikes
4. Alert fires → webhook hits 3AM → `INC-0001` created
5. TrueForge session opens → agent queries Grafana MCP + Sentry MCP
6. RCA lands → check `incidents/INC-0001-report.md`
7. Click **"Stop All"** → metrics recover → incident auto-closes

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| TrueForge UI won't load | Check `npx` terminal for errors; ensure port 8791 free |
| MCP `auth_required` | Click **Connect** in Settings → Connectors for that MCP |
| Agent returns no tools | Verify MCP shows **Connected/Authenticated** in Settings |
| 3AM `fetch failed` | TrueForge must run on `0.0.0.0:8791` (not 127.0.0.1) |
| `agent.json` not found in container | Compose mounts `./trueforge:/app/trueforge:ro` |
| Neon connection error | Use **unpooled** URL (remove `-pooler` from host) |

---

## Key Files

| File | Purpose |
|------|---------|
| `trueforge/agent.json` | Agent template (instructions, MCP list, response schema) |
| `trueforge/mcp.json` | MCP connector definitions (for reference) |
| `apps/3am/scripts/verify-agent.mjs` | SDK test script |
| `apps/3am/src/investigate.js` | Prompt builder + RCA parser |
| `docker-compose.yml` | Blog + Alloy + 3AM (TrueForge runs separately) |