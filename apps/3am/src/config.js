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
  // Grafana Cloud stack + the dashboard under investigation. Falls back to
  // building the dashboard URL from the stack URL and dashboard UID.
  grafana: {
    stackUrl: (process.env.GRAFANA_CLOUD_STACK ?? '').replace(/\/$/, ''),
    dashboardUid: process.env.GRAFANA_DASHBOARD_UID ?? 'blog-overview',
    dashboardTitle: process.env.GRAFANA_DASHBOARD_TITLE ?? 'Blog Overview',
  },
  sentryProject: process.env.SENTRY_PROJECT ?? undefined,
  // Dedupe window: repeat alerts for the same key join the open incident.
  dedupeWindowMs: Number(process.env.DEDUPE_WINDOW_MS ?? 5 * 60 * 1000),
  // How far back the agent compares against when judging "is this abnormal".
  baselineWindowMs: Number(process.env.BASELINE_WINDOW_MS ?? 60 * 60 * 1000),
  // How long to wait for an investigation turn before giving up.
  investigateTimeoutMs: Number(process.env.INVESTIGATE_TIMEOUT_MS ?? 10 * 60 * 1000),
};

// Dashboard deep link the agent can cite in the RCA.
config.grafana.dashboardUrl = process.env.GRAFANA_DASHBOARD_URL ??
  (config.grafana.stackUrl
    ? `${config.grafana.stackUrl}/d/${config.grafana.dashboardUid}`
    : null);

export function assertConfig() {
  if (!config.trueforge.model) {
    console.warn('[3am] TRUEFORGE_MODEL unset — agent.json model placeholder will be sent as-is');
  }
  if (!config.grafana.dashboardUrl) {
    console.warn('[3am] GRAFANA_CLOUD_STACK unset — RCA will not include a dashboard link');
  }
}
