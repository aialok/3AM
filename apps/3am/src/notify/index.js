// Notify orchestrator: Notion first (full RCA), then Slack (concise + link).
// Never throws — failures are recorded on the incident timeline.
import { postToNotion } from './notion.js';
import { postToSlack } from './slack.js';

export async function notifyIncident(incident) {
  let notionUrl = incident.notionUrl ?? null;
  try {
    const n = await postToNotion(incident);
    if (!n.skipped) {
      incident.notionUrl = n.url;
      notionUrl = n.url;
      incident.timeline.push({
        at: new Date().toISOString(),
        event: `Notion RCA page created${n.url ? `: ${n.url}` : ` (${n.id})`}`,
      });
    } else {
      incident.timeline.push({ at: new Date().toISOString(), event: 'Notion skipped (no token)' });
    }
  } catch (err) {
    incident.timeline.push({ at: new Date().toISOString(), event: `Notion failed: ${err.message}` });
  }
  try {
    const s = await postToSlack(incident, { notionUrl });
    if (!s.skipped) {
      incident.timeline.push({
        at: new Date().toISOString(),
        event: `Slack posted to ${s.channel ?? 'channel'} (${s.ts ?? 'no ts'})`,
      });
    } else {
      incident.timeline.push({ at: new Date().toISOString(), event: 'Slack skipped (no token)' });
    }
  } catch (err) {
    incident.timeline.push({ at: new Date().toISOString(), event: `Slack failed: ${err.message}` });
  }
  return incident;
}
