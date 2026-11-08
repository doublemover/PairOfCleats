import { normalizeMatchSpelling, containsNormalizedText, findNormalizedTextRange } from '../../normalized-text.js';
import { createRenderSourceReader, isRenderSourceReader, MAX_RENDER_SCAN_CHARS } from '../source-snapshot.js';

import { stripVTControlCharacters } from 'node:util';

import { ANSI } from './ansi.js';

/** Never pass repository-controlled terminal escapes, controls or bidi overrides through. */
export function sanitizeTerminalText(value, { multiline = true } = {}) {
  const text = stripVTControlCharacters(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return multiline ? text : text.replace(/[\r\n\t]/g, ' ');
}

export function sanitizeTerminalMetadata(value, seen = new WeakMap(), depth = 0) {
  if (typeof value === 'string') return sanitizeTerminalText(value, { multiline: false });
  if (!value || typeof value !== 'object' || depth > 32) return value;
  if (seen.has(value)) return seen.get(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) return value;
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(result, sanitizeTerminalText(key, { multiline: false }), {
      value: sanitizeTerminalMetadata(entry, seen, depth + 1), enumerable: true, configurable: true, writable: true
    });
  }
  return result;
}

const normalizePreviewTokens = (tokens) => Array.isArray(tokens)
  ? [...new Set(tokens.slice(0, 64).filter((token) => typeof token === 'string' && token.trim())
    .map((token) => normalizeMatchSpelling(sanitizeTerminalText(token, { multiline: false }).slice(0, 128)))
    .filter(Boolean))]
  : [];

const containsQueryText = containsNormalizedText;

const sourceSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });
const clipSourceLine = (text, limit, tokens) => {
  if (text.length <= limit) return text;
  if (limit <= 1) return '…';
  const match = findNormalizedTextRange(text, tokens);
  const from = match && match.end > limit - 1
    ? Math.max(0, match.start - Math.floor(limit / 3)) : 0;
  const prefix = from ? '…' : '';
  const parts = [];
  let length = prefix.length;
  let truncated = false;
  for (const { segment, index } of sourceSegments.segment(text)) {
    if (index + segment.length <= from) continue;
    if (length + segment.length > limit) { truncated = true; break; }
    parts.push(segment);
    length += segment.length;
  }
  if (truncated && length >= limit) parts.pop();
  return `${prefix}${parts.join('')}${truncated ? '…' : ''}`;
};

const selectSourcePreview = (text, chunk, { maxLines = 8, maxChars = 1600, queryTokens = [] } = {}, sourceReader) => {
  const lineLimit = Number.isSafeInteger(maxLines) ? Math.max(1, Math.min(8, maxLines)) : 8;
  const charLimit = Number.isSafeInteger(maxChars) ? Math.max(1, Math.min(1600, maxChars)) : 1600;
  const scanEnd = Math.min(text.length, chunk.end, chunk.start + MAX_RENDER_SCAN_CHARS);
  if (!sourceReader.admitScan(Math.min(chunk.start, text.length) + Math.max(0, scanEnd - chunk.start))) return null;
  const raw = text.slice(chunk.start, scanEnd);
  if (!raw.trim()) return null;
  const rawLines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (rawLines.at(-1) === '') rawLines.pop();
  const tokens = normalizePreviewTokens(queryTokens);
  const firstMatch = tokens.length ? rawLines.findIndex((line) => containsQueryText(line, tokens)) : -1;
  const first = Math.max(0, Math.min(firstMatch - (lineLimit > 1 ? 1 : 0), rawLines.length - lineLimit));
  const selected = rawLines.slice(first, first + lineLimit);
  let remaining = charLimit;
  const lines = [];
  const matchLines = [];
  for (const line of selected) {
    if (remaining <= 0) break;
    const safe = sanitizeTerminalText(line);
    // Divide the display budget so a long context line cannot hide the matching line.
    const limit = Math.max(1, Math.floor(remaining / (selected.length - lines.length)));
    const displayed = clipSourceLine(safe, limit, tokens);
    if (tokens.length && containsQueryText(displayed, tokens)) matchLines.push(lines.length);
    lines.push(displayed);
    remaining -= displayed.length;
  }
  // The offsets are indexed, but the line numbers must describe the bytes just read.
  let startLine = 1 + first;
  const prefixEnd = Math.min(chunk.start, text.length);
  for (let i = 0; i < prefixEnd; i++) {
    const char = text.charCodeAt(i);
    if (char === 13) { startLine++; if (i + 1 < prefixEnd && text.charCodeAt(i + 1) === 10) i++; }
    else if (char === 10) startLine++;
  }
  const truncatedBefore = first > 0;
  const truncatedAfter = first + lines.length < rawLines.length || scanEnd < Math.min(text.length, chunk.end);
  return { lines, startLine, matchLines, queryTokens: tokens, truncatedBefore, truncatedAfter,
    truncated: truncatedBefore || truncatedAfter };
};

/** One render owns this bounded cache; edits are read afresh on the next render. */
export function createSourcePreviewReader(rootDir, options = {}) {
  const sourceReader = options.sourceReader || createRenderSourceReader(rootDir, options);
  if (!isRenderSourceReader(sourceReader, rootDir)) throw new TypeError('Preview requires its actual render source owner.');
  const read = (chunk, previewOptions = {}) => {
    const source = sourceReader.read(chunk);
    return source.state === 'available' ? selectSourcePreview(source.snapshot.text, chunk, previewOptions, sourceReader) : null;
  };
  Object.defineProperty(read, 'sourceReader', { value: sourceReader });
  return Object.freeze(read);
}

/** Bounded, root-confined working-tree preview; no external source references. */
export function readSourcePreview(rootDir, chunk, options = {}) {
  return createSourcePreviewReader(rootDir, { sourceReader: options.sourceReader })(chunk, options);
}

const KEYWORDS = new Set(('async await break case catch class const continue default def do else enum export extends false finally fn for from function if implements import in interface let match new null private protected public raise return static struct super switch this throw true try type typeof undefined var void while yield').split(' '));
const TOKEN = /(?:\/\/|#).*|\/\*.*?\*\/|"(?:[\x5c].|[^"\x5c])*"|'(?:[\x5c].|[^'\x5c])*'|`(?:[\x5c].|[^`\x5c])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;

/** Lightweight lexical styling only; no execution and no claim to parse a language. */
export function highlightSourceLine(text, { styled = true } = {}) {
  const safe = sanitizeTerminalText(text);
  if (!styled) return safe;
  return safe.replace(TOKEN, (token) => {
    const color = /^(?:\/\/|#|\/\*)/.test(token) ? ANSI.fgDarkGray
      : /^["'`]/.test(token) ? ANSI.fgLightGreen
        : /^\d/.test(token) ? ANSI.fgOrange
          : KEYWORDS.has(token) ? ANSI.fgPurple : null;
    return color ? `${color}${token}${ANSI.reset}` : token;
  });
}

export function formatSourcePreview(preview, { styled = true, columns = 108 } = {}) {
  if (!preview) return '';
  const digits = String(preview.startLine + preview.lines.length - 1).length;
  const marked = preview.matchLines?.length > 0;
  const width = Math.max(1, columns - digits - (marked ? 9 : 7));
  const lines = preview.lines.map((line, index) => {
    const expanded = line.replace(/\t/g, '  ');
    const clipped = clipSourceLine(expanded, width, preview.queryTokens || []);
    const number = String(preview.startLine + index).padStart(digits);
    const gutter = styled ? `${ANSI.fgDarkGray}${number} │${ANSI.reset}` : `${number} |`;
    const marker = marked ? (preview.matchLines.includes(index)
      && containsQueryText(clipped, preview.queryTokens || []) ? '> ' : '  ') : '';
    return `  ${marker}${gutter} ${highlightSourceLine(clipped, { styled })}`;
  });
  const before = preview.truncatedBefore ? '  …\n' : '';
  const after = preview.truncatedAfter ?? preview.truncated;
  return `  working-tree excerpt${marked ? ' (> query text)' : ''}\n${before}${lines.join('\n')}\n${after ? '  …\n' : ''}`;
}
