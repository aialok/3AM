// RCA markdown template — single source of truth for Notion + file reports.
// Clearly separates observed facts (evidence) from unconfirmed hypotheses.
export function formatRcaMarkdown(incident) {
  const rca = incident.rca ?? {};
  const lines = [];
  lines.push(`# Incident Report — ${incident.id}`);
  lines.push('');
  lines.push(
    `**Alert:** ${incident.alertname} on ${incident.service} | **Status:** ${incident.status} | **Session:** ${incident.sessionId ?? 'n/a'}`
  );
  lines.push(
    `**Opened:** ${incident.createdAt} | **Re-alerts (deduped):** ${Math.max(0, (incident.alertCount ?? 1) - 1)}`
  );
  lines.push('');
  lines.push('## Summary');
  lines.push(rca.summary ?? '_No RCA summary — investigation did not complete._');
  lines.push('');
  lines.push(
    `**Started at:** ${rca.started_at ?? incident.startsAt ?? 'unknown'} | **Affected service:** ${rca.affected_service ?? incident.service}`
  );
  lines.push(`**Customer impact:** ${rca.customer_impact ?? 'unknown'}`);
  lines.push('');
  lines.push('## Timeline (observed)');
  const timeline = Array.isArray(rca.timeline) && rca.timeline.length
    ? rca.timeline
    : incident.timeline ?? [];
  if (timeline.length === 0) {
    lines.push('- _No timeline events recorded._');
  } else {
    for (const t of timeline) lines.push(`- ${t.at}: ${t.event}`);
  }
  lines.push('');
  lines.push('## Root cause');
  lines.push(rca.root_cause ?? '_Undetermined._');
  lines.push('');
  lines.push('## Evidence (facts)');
  if (Array.isArray(rca.evidence) && rca.evidence.length) {
    for (const e of rca.evidence) lines.push(`- [${e.source}] ${e.fact}`);
  } else {
    lines.push('- _No corroborating evidence retrieved._');
  }
  lines.push('');
  lines.push('## Hypotheses (unconfirmed)');
  if (Array.isArray(rca.hypotheses) && rca.hypotheses.length) {
    for (const h of rca.hypotheses) lines.push(`- ${h}`);
  } else {
    lines.push('- _None._');
  }
  lines.push('');
  lines.push(`**Confidence:** ${rca.confidence ?? 'n/a'}`);
  lines.push('');
  lines.push('## Mitigation');
  lines.push(`- Now: ${rca.mitigation_now ?? '_No immediate mitigation proposed._'}`);
  lines.push(`- Follow-up: ${rca.follow_up ?? '_No follow-up proposed._'}`);
  lines.push('');
  lines.push('## 3AM pipeline timeline');
  for (const t of incident.timeline ?? []) lines.push(`- ${t.at}: ${t.event}`);
  lines.push('');
  return lines.join('\n');
}

// Concise Slack text: summary + key fields + Notion link when available.
export function formatSlackText(incident, notionUrl) {
  const rca = incident.rca ?? {};
  const first = (rca.summary ?? 'RCA ready').split('\n')[0].slice(0, 280);
  const parts = [
    `:rotating_light: *${incident.id} — ${incident.alertname} on ${incident.service}* (${incident.status})`,
    `>${first}`,
    `>Started: ${rca.started_at ?? incident.startsAt ?? 'unknown'} | Confidence: ${rca.confidence ?? 'n/a'} | Session: ${incident.sessionId ?? 'n/a'}`,
    rca.mitigation_now ? `>Mitigate now: ${String(rca.mitigation_now).slice(0, 280)}` : null,
    notionUrl ? `>Full RCA: ${notionUrl}` : `>Full RCA: GET /incidents/${incident.id}`,
  ].filter(Boolean);
  return parts.join('\n');
}
