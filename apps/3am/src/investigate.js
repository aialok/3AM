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

// Investigation brief. Only facts 3AM actually knows are stated here — the
// agent's own instructions already cover tool usage and method, so repeating
// them in the prompt just wastes context and invites drift.
function investigationPrompt(incident) {
  const started = new Date(incident.startsAt ?? Date.now());
  const baselineStart = new Date(started.getTime() - config.baselineWindowMs);

  const lines = [
    `# Incident ${incident.id}`,
    '',
    `Alert:      ${incident.alertname}`,
    `Service:    ${incident.service}`,
    `Severity:   ${incident.labels?.severity ?? 'unknown'}`,
    `Fired at:   ${started.toISOString()}`,
    `Investigate window: ${started.toISOString()} → now`,
    `Baseline window:   ${baselineStart.toISOString()} → ${started.toISOString()}`,
    `Re-alerts (deduped into this incident): ${Math.max(0, (incident.alertCount ?? 1) - 1)}`,
  ];

  if (config.grafana.dashboardUrl) {
    lines.push(`Grafana dashboard "${config.grafana.dashboardTitle}": ${config.grafana.dashboardUrl}`);
  }
  if (config.sentryProject) {
    lines.push(`Sentry project: ${config.sentryProject}`);
  }

  const extra = Object.entries(incident.labels ?? {})
    .filter(([k]) => !['alertname', 'service', 'severity'].includes(k));
  if (extra.length) {
    lines.push(`Other alert labels: ${JSON.stringify(Object.fromEntries(extra))}`);
  }

  lines.push(
    '',
    'Correlate Grafana and Sentry over the investigate window against the baseline, then return the RCA JSON.'
  );
  return lines.join('\n');
}

// response_format guarantees JSON, but tolerate fences if a model adds them.
export function parseRca(content) {
  const text = String(content ?? '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : text);
}
