import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { toRealPathSync } from '../../../workspace/identity.js';
import { openContainedFileSync } from '../../../shared/contained-file.js';
import { decodeTextBuffer } from '../../../shared/encoding.js';
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

/** Bounded, root-confined working-tree preview; does not resolve external source references. */
export function readSourcePreview(rootDir, chunk, { maxLines = 8, maxChars = 1600 } = {}) {
  if (!rootDir || !chunk?.file || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end)
    || chunk.start < 0 || chunk.end <= chunk.start) return null;
  let fd = null;
  try {
    const root = toRealPathSync(path.resolve(rootDir));
    const file = path.resolve(root, chunk.file);
    fd = openContainedFileSync(root, file);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 512 * 1024) return null;
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) return null;
    const { text } = decodeTextBuffer(buffer.subarray(0, offset), { filePath: file });
    const raw = text.slice(chunk.start, Math.min(chunk.end, chunk.start + maxChars));
    if (!raw.trim()) return null;
    const rawLines = raw.replace(/\r\n?/g, '\n').split('\n');
    const lines = rawLines.slice(0, maxLines).map((line) => sanitizeTerminalText(line));
    const startLine = Number.isSafeInteger(chunk.startLine) && chunk.startLine > 0
      ? chunk.startLine : text.slice(0, chunk.start).split(/\r\n|\r|\n/).length;
    return { lines, startLine,
      truncated: rawLines.length > maxLines || chunk.end - chunk.start > maxChars };
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
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
  const width = Math.max(20, columns - digits - 7);
  const lines = preview.lines.map((line, index) => {
    const expanded = line.replace(/\t/g, '  ');
    const units = Array.from(expanded);
    const clipped = units.length > width ? `${units.slice(0, width - 1).join('')}…` : expanded;
    const number = String(preview.startLine + index).padStart(digits);
    const gutter = styled ? `${ANSI.fgDarkGray}${number} │${ANSI.reset}` : `${number} |`;
    return `  ${gutter} ${highlightSourceLine(clipped, { styled })}`;
  });
  return `  working-tree excerpt\n${lines.join('\n')}\n${preview.truncated ? '  …\n' : ''}`;
}
