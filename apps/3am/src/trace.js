import { config } from './config.js';

// Turns a TrueForge session's raw event log into a readable investigation
// trace. The point is to make the agent's method legible: which system it
// asked, what it asked, and what came back — so a human can audit the
// reasoning instead of taking the RCA on faith.

// Fields worth surfacing per tool, in priority order. The PromQL expression or
// the Sentry query is the interesting part; the rest is plumbing.
const INTERESTING = [
  'expr',            // grafana query_prometheus
  'query',           // sentry search_events / search_issues
  'resourceId',      // sentry get_sentry_resource
  'resourceType',
  'uid',             // grafana dashboard by uid
  'title',
  'name',
  'type',
  'limit',
];

// Discovery calls the harness makes to learn the tool surface. Real work
// happens after these, so they're collapsed rather than shown as steps.
const DISCOVERY = new Set(['get_tool_info', 'list_tools', 'search_sentry_tools']);

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
}

// One-line human summary of what was asked.
function summarize(args) {
  const inner = args.input ?? args;
  for (const key of INTERESTING) {
    const v = inner[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function preview(content, max = 320) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * @param {string} sessionId TrueForge session id
 * @param {typeof fetch} fetchImpl injectable for tests
 */
export async function buildTrace(sessionId, fetchImpl = fetch) {
  if (!sessionId) return { steps: [], discovery: 0, totals: {} };

  const base = config.trueforge.baseUrl;
  const res = await fetchImpl(
    `${base}/api/v1/sessions/${sessionId}/events?order=asc`
  );
  if (!res.ok) return { steps: [], discovery: 0, totals: {}, error: `HTTP ${res.status}` };

  const raw = (await res.json()).data ?? [];
  const events = raw.map((e) => e.event ?? e);

  // Index responses by the call they answer.
  const responses = new Map();
  for (const e of events) {
    if (e.type === 'tool.response' && e.tool_call_id) {
      responses.set(e.tool_call_id, { at: e.created_at, content: e.content });
    }
  }

  const steps = [];
  const totals = { grafana: 0, sentry: 0, discovery: 0, other: 0 };
  let discovery = 0;

  for (const e of events) {
    if (e.type !== 'model.message') continue;

    for (const call of e.tool_calls ?? []) {
      const fn = call.function ?? {};
      const args = parseArgs(fn.arguments);
      const name = fn.name;
      const server = args.mcp_server ?? args.server ?? null;
      const tool = args.tool_name ?? name;

      if (DISCOVERY.has(name)) {
        discovery += 1;
        totals.discovery += 1;
        continue;
      }

      if (server === 'grafana') totals.grafana += 1;
      else if (server === 'sentry') totals.sentry += 1;
      else totals.other += 1;

      const r = responses.get(call.id);
      steps.push({
        at: e.created_at,
        server,
        tool,
        detail: summarize(args),
        args,
        resultPreview: r ? preview(r.content) : null,
        resultAt: r?.at ?? null,
      });
    }
  }

  steps.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { steps, discovery, totals, sessionId };
}
