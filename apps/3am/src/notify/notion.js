// Real Notion poster. Env only — no mocks, no hardcoded secrets.
// Requires NOTION_TOKEN + NOTION_DATABASE_ID. Missing config → skip (not error).
// Database schema is discovered at runtime: the first `title` property is used,
// so any Notion database works without hardcoding property names.
import { formatRcaMarkdown } from './rca.js';

const NOTION_VERSION = '2022-06-28';

export function notionConfigured() {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID);
}

async function notionFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`notion ${method} ${path} failed: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function resolveTitleProperty(databaseId) {
  const db = await notionFetch(`/databases/${databaseId}`);
  const props = db.properties ?? {};
  for (const [name, def] of Object.entries(props)) {
    if (def?.type === 'title') return name;
  }
  const first = Object.keys(props)[0];
  if (!first) throw new Error('notion database has no properties');
  return first;
}

function markdownToBlocks(markdown) {
  // Notion blocks cap at 2000 chars — split long markdown into paragraphs.
  const chunks = [];
  let current = '';
  for (const line of String(markdown).split('\n')) {
    if ((current + '\n' + line).length > 1900) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((text) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] },
  }));
}

export async function postToNotion(incident) {
  if (!notionConfigured()) {
    console.log('[3am] Notion skipped — NOTION_TOKEN/NOTION_DATABASE_ID unset');
    return { skipped: true };
  }
  const databaseId = process.env.NOTION_DATABASE_ID;
  const titleProp = await resolveTitleProperty(databaseId);
  const rca = incident.rca ?? {};
  const title = `${incident.id} — ${incident.alertname} on ${incident.service}: ${(rca.summary ?? 'RCA').split('\n')[0].slice(0, 80)}`;
  const page = await notionFetch('/pages', {
    method: 'POST',
    body: {
      parent: { database_id: databaseId },
      properties: {
        [titleProp]: { title: [{ text: { content: title.slice(0, 100) } }] },
      },
      children: markdownToBlocks(formatRcaMarkdown(incident)).slice(0, 100),
    },
  });
  return { skipped: false, id: page.id, url: page.url ?? null };
}
