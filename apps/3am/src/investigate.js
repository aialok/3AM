import { config } from './config.js';
import { openIncidentSession, runTurnToCompletion } from './trueforge.js';
import { notifyIncident } from './notify/index.js';
import { updateIncidentSession, updateIncidentRCA, updateIncidentError, addTimelineEvent } from './incidents.js';

// Builds the investigation prompt, runs the turn, parses the RCA JSON.
// Persists updates to DB. Never throws — failures recorded on incident.
export async function investigate(incident) {
  await addTimelineEvent(incident.id, { at: new Date().toISOString(), event: 'Investigation started' });
  try {
    const session = await openIncidentSession(incident);
    await updateIncidentSession(incident.id, session.id);
    const turn = await runTurnToCompletion(session.id, [
      { type: 'user.message', content: investigationPrompt(incident) },
    ]);
    if (turn.state.status !== 'done' || !turn.state.output) {
      throw new Error(`turn ended: ${turn.state.status} ${turn.state.message ?? ''}`.trim());
    }
    const rca = parseRca(turn.state.output.content);
    await updateIncidentRCA(incident.id, rca);
    await addTimelineEvent(incident.id, { at: new Date().toISOString(), event: 'RCA ready' });
    await notifyIncident({ ...incident, rca, status: 'done' });
  } catch (err) {
    await updateIncidentError(incident.id, err.message);
    await addTimelineEvent(incident.id, { at: new Date().toISOString(), event: `Investigation failed: ${err.message}` });
  }
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
