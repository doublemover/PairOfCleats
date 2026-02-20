import { toPosix } from '../../../shared/files.js';
import { isDocsPath } from '../mode-routing.js';

const DOCS_SEARCH_JSON_FILE = 'search.json';
const MAX_ENTRIES_DEFAULT = 50000;
const MAX_ABSTRACT_CHARS_DEFAULT = 320;
const MAX_LINE_CHARS_DEFAULT = 640;
const FAST_SCAN_MIN_INPUT_CHARS_DEFAULT = 1_500_000;
const FAST_SCAN_WINDOW_CHARS_DEFAULT = 4096;
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

const decodeJsonString = (raw) => {
  if (typeof raw !== 'string') return '';
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
};

const extractStringField = (window, field) => {
  if (!window) return '';
  const rx = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'i');
  const match = window.match(rx);
  if (!match) return '';
  return decodeJsonString(match[1]);
};

/**
 * Collect byte ranges for top-level objects inside a JSON array without fully
 * parsing the payload, capped by `entryLimit`.
 *
 * @param {string} text
 * @param {number} entryLimit
 * @returns {Array<{start:number,end:number}>}
 */
const collectTopLevelArrayObjectRanges = (text, entryLimit) => {
  const ranges = [];
  if (!text || !entryLimit) return ranges;
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== '[') return ranges;
  let arrayDepth = 1;
  let objectDepth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  for (i += 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      arrayDepth += 1;
      continue;
    }
    if (ch === ']') {
      arrayDepth -= 1;
      if (arrayDepth <= 0) break;
      continue;
    }
    if (ch === '{') {
      objectDepth += 1;
      if (arrayDepth === 1 && objectDepth === 1) {
        objectStart = i;
      }
      continue;
    }
    if (ch === '}' && objectDepth > 0) {
      objectDepth -= 1;
      if (arrayDepth === 1 && objectDepth === 0 && objectStart >= 0) {
        ranges.push({ start: objectStart, end: i + 1 });
        objectStart = -1;
        if (ranges.length >= entryLimit) break;
      }
    }
  }
  return ranges;
};

/**
 * Collect candidate top-level object-member route heads (`"route": {`) without
 * matching nested payload keys.
 *
 * @param {string} text
 * @param {number} entryLimit
 * @returns {Array<{start:number,routeRaw:string}>}
 */
const collectTopLevelObjectEntryHeads = (text, entryLimit) => {
  const heads = [];
  if (!text || !entryLimit) return heads;
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== '{') return heads;
  let objectDepth = 1;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;
  const parseStringAt = (start) => {
    let raw = '';
    let localEscaped = false;
    for (let cursor = start + 1; cursor < text.length; cursor += 1) {
      const ch = text[cursor];
      if (localEscaped) {
        raw += ch;
        localEscaped = false;
        continue;
      }
      if (ch === '\\') {
        raw += ch;
        localEscaped = true;
        continue;
      }
      if (ch === '"') {
        return { raw, end: cursor };
      }
      raw += ch;
    }
    return null;
  };
  for (i += 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      if (objectDepth === 1 && arrayDepth === 0) {
        const keyToken = parseStringAt(i);
        if (!keyToken) break;
        let cursor = keyToken.end + 1;
        while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
        if (text[cursor] === ':') {
          cursor += 1;
          while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
          if (text[cursor] === '{') {
            heads.push({ start: i, routeRaw: keyToken.raw });
            if (heads.length >= entryLimit) break;
          }
        }
        i = keyToken.end;
        continue;
      }
      inString = true;
      continue;
    }
    if (ch === '{') {
      objectDepth += 1;
      continue;
    }
    if (ch === '}') {
      objectDepth -= 1;
      if (objectDepth <= 0) break;
      continue;
    }
    if (ch === '[') {
      arrayDepth += 1;
      continue;
    }
    if (ch === ']') {
      if (arrayDepth > 0) arrayDepth -= 1;
    }
  }
  return heads;
};

/**
 * Fast-scan large docs `search.json` payloads and extract compact
 * `route | name | parent | abstract` lines from local windows.
 *
 * This avoids whole-document `JSON.parse` for multi-megabyte blobs while still
 * preserving representative text for indexing.
 *
 * @param {string} text
 * @param {{entryLimit:number,abstractLimit:number,lineLimit:number,scanWindowChars?:number}} options
 * @returns {string|null}
 */
const compactDocsSearchJsonTextFastScan = (
  text,
  {
    entryLimit,
    abstractLimit,
    lineLimit,
    scanWindowChars = FAST_SCAN_WINDOW_CHARS_DEFAULT
  }
) => {
  const lines = [];
  const windowChars = Number.isFinite(Number(scanWindowChars)) && scanWindowChars > 0
    ? Math.max(512, Math.floor(Number(scanWindowChars)))
    : FAST_SCAN_WINDOW_CHARS_DEFAULT;
  const entryHeads = collectTopLevelObjectEntryHeads(text, entryLimit);
  for (let i = 0; i < entryHeads.length; i += 1) {
    if (lines.length >= entryLimit) break;
    const head = entryHeads[i];
    const route = decodeJsonString(head.routeRaw);
    if (!route) continue;
    const start = head.start;
    const nextStart = i + 1 < entryHeads.length ? entryHeads[i + 1].start : text.length;
    const end = Math.min(text.length, start + windowChars, nextStart);
    const window = text.slice(start, end);
    const name = extractStringField(window, 'name') || extractStringField(window, 'title');
    const parent = extractStringField(window, 'parent_name') || extractStringField(window, 'parent');
    const abstract = extractStringField(window, 'abstract')
      || extractStringField(window, 'description')
      || extractStringField(window, 'text')
      || extractStringField(window, 'content');
    const normalized = normalizeEntry(route, {
      name,
      parent_name: parent,
      abstract
    }, abstractLimit);
    if (!normalized) continue;
    lines.push(trimToLimit(normalized, lineLimit));
  }
  if (!lines.length) {
    const arrayEntryRanges = collectTopLevelArrayObjectRanges(text, entryLimit);
    for (const range of arrayEntryRanges) {
      if (lines.length >= entryLimit) break;
      const end = Math.min(range.end, range.start + windowChars);
      const window = text.slice(range.start, end);
      const route = extractStringField(window, 'route')
        || extractStringField(window, 'path')
        || extractStringField(window, 'url')
        || extractStringField(window, 'id');
      const name = extractStringField(window, 'name') || extractStringField(window, 'title');
      const parent = extractStringField(window, 'parent_name') || extractStringField(window, 'parent');
      const abstract = extractStringField(window, 'abstract')
        || extractStringField(window, 'description')
        || extractStringField(window, 'text')
        || extractStringField(window, 'content');
      const normalized = normalizeEntry(route, {
        name,
        parent_name: parent,
        abstract
      }, abstractLimit);
      if (!normalized) continue;
      lines.push(trimToLimit(normalized, lineLimit));
    }
  }
  if (!lines.length) return null;
  return `${lines.join('\n')}\n`;
};

/**
 * Detect whether a file path is a docs search index candidate (`search.json`
 * under a docs route) eligible for compaction.
 *
 * @param {{mode:string,ext:string,relPath:string}} input
 * @returns {boolean}
 */
export const isDocsSearchIndexJsonPath = ({ mode, ext, relPath }) => {
  const normalizedExt = String(ext || '').toLowerCase();
  if (normalizedExt !== '.json') return false;
  const normalizedPath = toPosix(String(relPath || '')).trim();
  if (!normalizedPath) return false;
  const baseName = normalizedPath.split('/').pop()?.toLowerCase() || '';
  if (baseName !== DOCS_SEARCH_JSON_FILE) return false;
  return isDocsPath(normalizedPath);
};

/**
 * Normalize docs search index JSON into compact, line-oriented text.
 *
 * Uses a fast scanner for very large inputs and falls back to JSON parsing to
 * support both object- and array-shaped payloads.
 *
 * @param {string} text
 * @param {{
 *   maxEntries?:number,
 *   maxAbstractChars?:number,
 *   maxLineChars?:number,
 *   fastScanMinInputChars?:number,
 *   fastScanWindowChars?:number
 * }} [options]
 * @returns {string|null}
 */
export const compactDocsSearchJsonText = (
  text,
  {
    maxEntries = MAX_ENTRIES_DEFAULT,
    maxAbstractChars = MAX_ABSTRACT_CHARS_DEFAULT,
    maxLineChars = MAX_LINE_CHARS_DEFAULT,
    fastScanMinInputChars = FAST_SCAN_MIN_INPUT_CHARS_DEFAULT,
    fastScanWindowChars = FAST_SCAN_WINDOW_CHARS_DEFAULT
  } = {}
) => {
  if (typeof text !== 'string' || !text.trim()) return null;
  const entryLimit = Number.isFinite(Number(maxEntries))
    ? Math.max(1, Math.floor(Number(maxEntries)))
    : MAX_ENTRIES_DEFAULT;
  const abstractLimit = Number.isFinite(Number(maxAbstractChars))
    ? Math.max(32, Math.floor(Number(maxAbstractChars)))
    : MAX_ABSTRACT_CHARS_DEFAULT;
  const lineLimit = Number.isFinite(Number(maxLineChars))
    ? Math.max(80, Math.floor(Number(maxLineChars)))
    : MAX_LINE_CHARS_DEFAULT;
  const fastScanThreshold = Number.isFinite(Number(fastScanMinInputChars))
    ? Math.max(0, Math.floor(Number(fastScanMinInputChars)))
    : FAST_SCAN_MIN_INPUT_CHARS_DEFAULT;
  if (fastScanThreshold > 0 && text.length >= fastScanThreshold) {
    const fastScanned = compactDocsSearchJsonTextFastScan(text, {
      entryLimit,
      abstractLimit,
      lineLimit,
      scanWindowChars: fastScanWindowChars
    });
    if (typeof fastScanned === 'string' && fastScanned.length > 0) {
      return fastScanned;
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
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
