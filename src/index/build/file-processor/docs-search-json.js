import { toPosix } from '../../../shared/files.js';
import { isDocsPath } from '../mode-routing.js';

const DOCS_SEARCH_JSON_FILE = 'search.json';
const MAX_ENTRIES_DEFAULT = 50000;
const MAX_ABSTRACT_CHARS_DEFAULT = 320;
const MAX_LINE_CHARS_DEFAULT = 640;
const MAX_ROUTE_CHARS = 220;
const MAX_NAME_CHARS = 180;
const MAX_PARENT_CHARS = 120;

const ENTITY_MAP = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', '\''],
  ['nbsp', ' '],
  ['hellip', '...'],
  ['rsquo', '\''],
  ['lsquo', '\''],
  ['rdquo', '"'],
  ['ldquo', '"']
]);

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const trimToLimit = (value, maxChars) => {
  if (!value) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
};

const decodeHtmlEntities = (value) => String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
  if (!body) return match;
  const lowered = String(body).toLowerCase();
  if (ENTITY_MAP.has(lowered)) return ENTITY_MAP.get(lowered);
  if (lowered.startsWith('#x')) {
    const codePoint = Number.parseInt(lowered.slice(2), 16);
    if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
      return String.fromCodePoint(codePoint);
    }
    return '';
  }
  if (lowered.startsWith('#')) {
    const codePoint = Number.parseInt(lowered.slice(1), 10);
    if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
      return String.fromCodePoint(codePoint);
    }
    return '';
  }
  return match;
});

const stripHtml = (value) => {
  const stripped = String(value || '').replace(/<[^>]*>/g, ' ');
  const decoded = decodeHtmlEntities(stripped);
  return normalizeWhitespace(decoded).replace(/\s+([.,;:!?])/g, '$1');
};

const normalizeEntry = (route, value, maxAbstractChars) => {
  if (!value || typeof value !== 'object') return null;
  const routeText = trimToLimit(normalizeWhitespace(route || value.path || value.url || value.route || ''), MAX_ROUTE_CHARS);
  const nameText = trimToLimit(normalizeWhitespace(value.name || value.title || ''), MAX_NAME_CHARS);
  const parentText = trimToLimit(normalizeWhitespace(value.parent_name || value.parent || ''), MAX_PARENT_CHARS);
  const abstractText = trimToLimit(
    stripHtml(value.abstract || value.description || value.text || value.content || ''),
    maxAbstractChars
  );
  if (!routeText && !nameText && !parentText && !abstractText) return null;
  return [routeText, nameText, parentText, abstractText].filter(Boolean).join(' | ');
};

export const isDocsSearchIndexJsonPath = ({ mode, ext, relPath }) => {
  const normalizedExt = String(ext || '').toLowerCase();
  if (normalizedExt !== '.json') return false;
  if (String(mode || '').toLowerCase() === 'code') return false;
  const normalizedPath = toPosix(String(relPath || '')).trim();
  if (!normalizedPath) return false;
  const baseName = normalizedPath.split('/').pop()?.toLowerCase() || '';
  if (baseName !== DOCS_SEARCH_JSON_FILE) return false;
  return isDocsPath(normalizedPath);
};

export const compactDocsSearchJsonText = (
  text,
  {
    maxEntries = MAX_ENTRIES_DEFAULT,
    maxAbstractChars = MAX_ABSTRACT_CHARS_DEFAULT,
    maxLineChars = MAX_LINE_CHARS_DEFAULT
  } = {}
) => {
  if (typeof text !== 'string' || !text.trim()) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const entryLimit = Number.isFinite(Number(maxEntries))
    ? Math.max(1, Math.floor(Number(maxEntries)))
    : MAX_ENTRIES_DEFAULT;
  const abstractLimit = Number.isFinite(Number(maxAbstractChars))
    ? Math.max(32, Math.floor(Number(maxAbstractChars)))
    : MAX_ABSTRACT_CHARS_DEFAULT;
  const lineLimit = Number.isFinite(Number(maxLineChars))
    ? Math.max(80, Math.floor(Number(maxLineChars)))
    : MAX_LINE_CHARS_DEFAULT;
  const lines = [];
  const appendLine = (route, value) => {
    if (lines.length >= entryLimit) return;
    const normalized = normalizeEntry(route, value, abstractLimit);
    if (!normalized) return;
    lines.push(trimToLimit(normalized, lineLimit));
  };

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      appendLine(entry?.path || entry?.url || entry?.route || entry?.id || '', entry);
      if (lines.length >= entryLimit) break;
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      appendLine(key, value);
      if (lines.length >= entryLimit) break;
    }
  }

  if (!lines.length) return null;
  return `${lines.join('\n')}\n`;
};
