import { config } from './config.js';
import { openIncidentSession, runTurnToCompletion } from './trueforge.js';

// Builds the investigation prompt, runs the turn, parses the RCA JSON.
// Mutates the incident (status, rca/error, timeline). Never throws —
// failures are recorded on the incident for GET /incidents/:id.
export async function investigate(incident) {
  incident.status = 'investigating';
  incident.timeline.push({ at: new Date().toISOString(), event: 'Investigation started' });
  try {
    const session = await openIncidentSession(incident);
    const turn = await runTurnToCompletion(session.id, [
      { type: 'user.message', content: investigationPrompt(incident) },
    ]);
    if (turn.state.status !== 'done' || !turn.state.output) {
      throw new Error(`turn ended: ${turn.state.status} ${turn.state.message ?? ''}`.trim());
    }
    incident.rca = parseRca(turn.state.output.content);
    incident.status = 'done';
    incident.timeline.push({ at: new Date().toISOString(), event: 'RCA ready' });
    // Phase 6 hook: notify/slack.js + notify/notion.js consume incident.rca here.
  } catch (err) {
    incident.error = err.message;
    incident.status = 'error';
    incident.timeline.push({ at: new Date().toISOString(), event: `Investigation failed: ${err.message}` });
  }
  return incident;
}

function investigationPrompt(incident) {
  return [
    `Incident ${incident.id}: Grafana alert "${incident.alertname}" firing on service "${incident.service}".`,
    `First seen: ${incident.startsAt}. Deduplicated re-alerts: ${incident.alertCount - 1}.`,
    `Grafana: ${config.grafanaBaseUrl} (dashboard: Blog Overview).`,
    incident.labels && Object.keys(incident.labels).length
      ? `Alert labels: ${JSON.stringify(incident.labels)}.`
      : '',
    'Investigate with the Grafana and Sentry MCP tools and return the RCA JSON.',
  ]
    .filter(Boolean)
    .join('\n');
}

// response_format guarantees JSON, but tolerate fences if a model adds them.
export function parseRca(content) {
  const text = String(content ?? '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : text);
}
