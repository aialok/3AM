// All 3AM config in one place. Env only — nothing hardcoded.
// See .env.example for every variable.
export const config = {
  port: Number(process.env.THREE_AM_PORT ?? 3001),
  trueforge: {
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
    agentName: process.env.TRUEFORGE_AGENT_NAME ?? 'three-am-investigator',
    // Overrides the model in trueforge/agent.json (placeholder there).
    model: process.env.TRUEFORGE_MODEL ?? undefined,
  },
  grafanaBaseUrl: process.env.GRAFANA_BASE_URL ?? 'http://localhost:3002',
  // Dedupe window: repeat alerts for the same key join the open incident.
  dedupeWindowMs: Number(process.env.DEDUPE_WINDOW_MS ?? 5 * 60 * 1000),
  // How long to wait for an investigation turn before giving up.
  investigateTimeoutMs: Number(process.env.INVESTIGATE_TIMEOUT_MS ?? 10 * 60 * 1000),
};

export function assertConfig() {
  if (!config.trueforge.model) {
    console.warn('[3am] TRUEFORGE_MODEL unset — agent.json model placeholder will be sent as-is');
  }
}
