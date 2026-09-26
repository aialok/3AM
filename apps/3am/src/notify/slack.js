// Real Slack poster. Env only — no mocks, no hardcoded secrets.
// Requires SLACK_BOT_TOKEN + SLACK_CHANNEL_ID. Missing config → skip (not error).
import { formatSlackText } from './rca.js';

const SLACK_API = 'https://slack.com/api/chat.postMessage';

export function slackConfigured() {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

export async function postToSlack(incident, { notionUrl = null } = {}) {
  if (!slackConfigured()) {
    console.log('[3am] Slack skipped — SLACK_BOT_TOKEN/SLACK_CHANNEL_ID unset');
    return { skipped: true };
  }
  const res = await fetch(SLACK_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: process.env.SLACK_CHANNEL_ID,
      text: formatSlackText(incident, notionUrl),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok !== true) {
    throw new Error(`slack post failed: ${res.status} ${data.error ?? JSON.stringify(data).slice(0, 200)}`);
  }
  return { skipped: false, ts: data.ts, channel: data.channel };
}
