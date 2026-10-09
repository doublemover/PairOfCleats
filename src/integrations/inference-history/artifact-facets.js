import { projectArtifact, sanitizeArtifactJson } from './artifact-projection.js';

/** Final report text is a document; embedded research activity remains separate. */
export function projectFinalReport({ message, title, sourceSha256, locator }) {
  if (message?.author?.role !== 'assistant' || message.channel !== 'final'
    || message.content?.content_type !== 'text'
    || !Array.isArray(message.content.parts)) return [];
  const body = message.content.parts.filter(part => typeof part === 'string').join('\n');
  const timestamp = message.create_time ?? message.timestamp;
  const ms = typeof timestamp === 'number' ? timestamp * 1000 : Date.parse(timestamp);
  const createdAt = Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000
    ? new Date(ms).toISOString() : null;
  return projectArtifact({ text: 'Final research report: ' + String(title).slice(0, 1024)
    + '\n' + body, sourceSha256, locator, kind: 'document', createdAt,
  dateBasis: createdAt ? 'declared_message_timestamp' : 'unknown' });
}

/** Static labels only: supplied scripts and embedded base64 assets are never executed/indexed. */
export function projectHtmlFacet({ text, sourceSha256, locator }) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024 * 1024)
    throw new Error('HTML facet byte limit exceeded.');
  const staticText = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const clean = value => value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim().slice(0, 256);
  const title = clean(staticText.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const labels = new Set();
  for (const match of staticText.matchAll(/<(?:button|label|option|h[1-3])[^>]*>([\s\S]*?)<\/(?:button|label|option|h[1-3])>/gi)) {
    const label = clean(match[1]);
    if (label) labels.add(label);
    if (labels.size >= 256) break;
  }
  return projectArtifact({ text: 'Static HTML application metadata\nTitle: ' + title
    + '\nControls and headings:\n' + [...labels].join('\n')
    + '\nScope: labels inspected as text; application behavior not executed.',
  sourceSha256, locator, kind: 'metadata' });
}

/** Source/media/layer facts retain original source hashes and explicit derived locators. */
export function projectMetadataFacet({ metadata, sourceSha256, locator }) {
  const text = JSON.stringify(sanitizeArtifactJson(metadata), null, 2);
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Metadata facet byte limit exceeded.');
  return projectArtifact({ text, sourceSha256, locator, kind: 'metadata' });
}
