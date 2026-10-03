import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 786432;
const MAX_LINES = 3500;
const MAX_TOKENS = 65536;
const MAX_TOKEN_CHARS = 32768;
const MAX_DEPTH = 64;
const MAX_NODES = 20000;
const MAX_MS = 30;
const EMPTY = Object.freeze([]);
const REFERENCES = new Set(['include', 'includes', 'import', 'imports', 'extends', 'ref', '$ref',
  'schema', 'source', 'registry', 'git']);
const INLINE_REFERENCES = new Set(['path', 'file', 'git', 'registry', 'url']);
const DEPENDENCIES = new Set(['dependencies', 'dev-dependencies', 'build-dependencies']);
class TomlBoundaryError extends Error {}

const ownValue = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const isTable = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && [null, Object.prototype].includes(Object.getPrototypeOf(value));

// Only key decoding uses this pass. Reference values come from the public
// semantic parser, never from regex or a guessed string-value conversion.
const decodeKey = (token) => {
  if (token.kind === 'bare' && /^[A-Za-z0-9_-]+$/u.test(token.raw)) return token.raw;
  if (token.kind !== 'string' || token.multiline) throw new TomlBoundaryError('unsupported-key');
  if (token.raw[0] === "'") return token.raw.slice(1, -1);
  const raw = token.raw.slice(1, -1);
  let decoded = '';
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== '\\') { decoded += raw[index]; continue; }
    const escape = raw[++index];
    if (['u', 'U', 'x'].includes(escape)) {
      const length = { u: 4, U: 8, x: 2 }[escape];
      const hex = raw.slice(index + 1, index + 1 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`, 'u').test(hex)) throw new TomlBoundaryError('unsupported-key-escape');
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new TomlBoundaryError('unsupported-key-escape');
      decoded += String.fromCodePoint(code);
      index += length;
    } else {
      const value = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' }[escape];
      if (value === undefined) throw new TomlBoundaryError('unsupported-key-escape');
      decoded += value;
    }
  }
  return decoded;
};

/** Public semantic values plus explicitly application-owned lexical ranges. */
export const createTomlStructureParser = ({ loadParser = () => require('smol-toml'),
  initializationNow, now = () => performance.now() } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, unsupportedReason: 'parser-unsupported',
    isSupported: (parser) => typeof parser?.parse === 'function',
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text, { maxMs = MAX_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'toml-unavailable', coverage: 'unavailable', reason,
      headings: EMPTY, importEntries: EMPTY, metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const started = Number(now());
    const configured = Number(maxMs);
    const localLimitMs = Number.isFinite(configured) && configured > 0 ? Math.max(1, Math.min(MAX_MS, Math.floor(configured))) : MAX_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const entryRemaining = remaining();
    metrics = { localLimitMs, effectiveLimitMsAtEntry: Number.isFinite(entryRemaining)
      ? Math.max(0, Math.min(localLimitMs, entryRemaining)) : entryRemaining === Infinity ? localLimitMs : 0 };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      const measured = elapsed();
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) throw new TomlBoundaryError('time-limit');
    };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      const lineIndex = buildLineIndex(source);
      checkTime();
      if (lineIndex.length > MAX_LINES) return fallback('line-limit', elapsed());
      const position = (start, end) => ({ start, end, line: offsetToLine(lineIndex, start) - 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)) - 1 });
      const tokens = [];
      const brackets = [];
      let dotChain = 1;
      const append = (kind, start, end, multiline = false) => {
        if (tokens.length >= MAX_TOKENS) throw new TomlBoundaryError('token-limit');
        if (end - start > MAX_TOKEN_CHARS) throw new TomlBoundaryError('token-length-limit');
        const raw = source.slice(start, end);
        if (raw === '.' && ++dotChain > MAX_DEPTH) throw new TomlBoundaryError('path-depth-limit');
        if (kind === 'newline' || ['=', ',', '[', ']', '{', '}'].includes(raw)) dotChain = 1;
        tokens.push({ kind, raw, multiline, ...position(start, end) });
      };
      let offset = 0;
      while (offset < source.length) {
        if ((offset & 127) === 0) checkTime();
        const start = offset;
        const char = source[offset];
        if (char === '\n') { append('newline', offset, ++offset); continue; }
        if (char === '\r' || char === ' ' || char === '\t') { offset += 1; continue; }
        if (char === '#') { const end = source.indexOf('\n', offset); offset = end < 0 ? source.length : end; continue; }
        if (char === '"' || char === "'") {
          const multiline = source.startsWith(char.repeat(3), offset);
          offset += multiline ? 3 : 1;
          let closed = false;
          while (offset < source.length) {
            if ((offset & 127) === 0) checkTime();
            if (offset - start > MAX_TOKEN_CHARS) throw new TomlBoundaryError('token-length-limit');
            if (char === '"' && source[offset] === '\\') { offset += 2; continue; }
            if (!multiline && ['\n', '\r'].includes(source[offset])) throw new TomlBoundaryError('unterminated-string');
            if (source[offset] === char) {
              if (!multiline) { offset += 1; closed = true; break; }
              let run = 0;
              while (source[offset + run] === char) run += 1;
              offset += run;
              if (run >= 3) { closed = true; break; }
            } else offset += 1;
          }
          if (!closed) throw new TomlBoundaryError('unterminated-string');
          append('string', start, offset, multiline);
          continue;
        }
        if ('[]{}=.,'.includes(char)) {
          if (char === '[' || char === '{') {
            if (brackets.length >= MAX_DEPTH) throw new TomlBoundaryError('depth-limit');
            brackets.push(char);
          } else if (char === ']' || char === '}') {
            if (brackets.pop() !== (char === ']' ? '[' : '{')) throw new TomlBoundaryError('unbalanced-containers');
          }
          append('punctuation', offset, ++offset);
          continue;
        }
        offset += 1;
        while (offset < source.length && !/[\s"'#\[\]{}=.,]/u.test(source[offset])) {
          if ((offset & 127) === 0) checkTime();
          offset += 1;
        }
        append('bare', start, offset);
      }
      if (brackets.length) throw new TomlBoundaryError('unbalanced-containers');
      checkTime();
      const vendor = loader.getParser();
      const document = vendor.parse(source, { maxDepth: MAX_DEPTH, integersAsBigInt: 'asNeeded', useLegacyDate: true, unsafeKeyBehaviour: 'keep' });
      checkTime();
      if (!isTable(document)) throw new TomlBoundaryError('unsupported-document');
      const seen = new Set();
      const data = [{ value: document, depth: 0 }];
      let nodeCount = 0;
      while (data.length) {
        checkTime();
        const { value, depth } = data.pop();
        if (++nodeCount > MAX_NODES) throw new TomlBoundaryError('node-limit');
        if (depth > MAX_DEPTH) throw new TomlBoundaryError('semantic-depth-limit');
        if (!value || typeof value !== 'object') continue;
        if (seen.has(value)) throw new TomlBoundaryError('cyclic-value');
        seen.add(value);
        if (!Array.isArray(value) && !isTable(value)) continue; // Dates are scalar values, never reference tables.
        for (const key of Object.keys(value)) data.push({ value: ownValue(value, key), depth: depth + 1 });
      }
      const headings = [];
      const importEntries = [];
      const arrayIndices = new Map();
      let sectionPath = [];
      const keyPath = (items) => {
        const path = [];
        for (let index = 0; index < items.length; index += 2) {
          checkTime();
          path.push(decodeKey(items[index]));
          if (path.length > MAX_DEPTH || (index + 1 < items.length && items[index + 1].raw !== '.')) throw new TomlBoundaryError('unsupported-key-path');
        }
        if (!path.length || items.length % 2 === 0) throw new TomlBoundaryError('unsupported-key-path');
        return path;
      };
      const getValue = (path) => {
        let value = document;
        for (const key of path) {
          checkTime();
          if (!value || typeof value !== 'object') throw new TomlBoundaryError('semantic-lexical-mismatch');
          value = ownValue(value, key);
        }
        if (value === undefined) throw new TomlBoundaryError('semantic-lexical-mismatch');
        return value;
      };
      const tablePath = (keys, arrayTable) => {
        const path = [];
        for (let index = 0; index < keys.length; index += 1) {
          path.push(keys[index]);
          const value = getValue(path);
          if (Array.isArray(value)) {
            const identity = JSON.stringify(path);
            const current = arrayTable && index === keys.length - 1 ? (arrayIndices.get(identity) ?? -1) + 1
              : arrayIndices.get(identity);
            if (!Number.isInteger(current) || !isTable(value[current])) throw new TomlBoundaryError('unsupported-array-table');
            arrayIndices.set(identity, current);
            path.push(current);
          }
        }
        if (!isTable(getValue(path))) throw new TomlBoundaryError('unsupported-table');
        return path;
      };
      const valuesFor = (value) => {
        checkTime();
        if (typeof value === 'string') return [value];
        if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
        if (isTable(value)) return Object.keys(value).filter((key) => INLINE_REFERENCES.has(key.toLowerCase()))
          .map((key) => ownValue(value, key)).filter((item) => typeof item === 'string');
        return [];
      };
      let cursor = 0;
      while (cursor < tokens.length) {
        checkTime();
        if (tokens[cursor].kind === 'newline') { cursor += 1; continue; }
        const start = cursor;
        let depth = 0;
        while (cursor < tokens.length) {
          checkTime();
          const raw = tokens[cursor].raw;
          if (['[', '{'].includes(raw)) depth += 1;
          if ([']', '}'].includes(raw)) depth -= 1;
          if (tokens[cursor].kind === 'newline' && !depth) break;
          cursor += 1;
        }
        const statement = tokens.slice(start, cursor).filter((token) => token.kind !== 'newline');
        if (!statement.length) continue;
        if (statement[0].raw === '[') {
          const arrayTable = statement[1]?.raw === '[';
          const padding = arrayTable ? 2 : 1;
          const keys = keyPath(statement.slice(padding, -padding));
          sectionPath = tablePath(keys, arrayTable);
          const range = position(statement[0].start, statement.at(-1).end);
          headings.push(Object.freeze({ name: source.slice(statement[padding].start, statement.at(-padding - 1).end).trim(),
            arrayTable, path: Object.freeze([...sectionPath]), sectionStart: lineIndex[range.line], ...range }));
          continue;
        }
        const equals = statement.findIndex((token) => token.raw === '=');
        if (equals < 1) throw new TomlBoundaryError('unsupported-assignment');
        const keys = keyPath(statement.slice(0, equals));
        const path = [...sectionPath, ...keys];
        const value = getValue(path);
        const key = keys.at(-1).toLowerCase();
        const dependency = path.findIndex((segment) => typeof segment === 'string' && DEPENDENCIES.has(segment.toLowerCase()));
        const dependencySpec = dependency >= 0 && path.length === dependency + 2;
        const dependencyField = dependency >= 0 && path.length === dependency + 3 && INLINE_REFERENCES.has(key);
        let values = REFERENCES.has(key) || dependencyField ? valuesFor(value) : [];
        if (dependencySpec) values = valuesFor(value).filter((item) => typeof value !== 'string'
          || item.includes('/') || item.startsWith('.') || item.includes(':'));
        const range = position(statement[0].start, statement.at(-1).end);
        for (const value of values) importEntries.push(Object.freeze({ value, ...range,
          keyRange: Object.freeze(position(statement[0].start, statement[equals - 1].end)), path: Object.freeze(path) }));
      }
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'smol-toml-values+lexical', coverage: 'partial', reason: null,
        rangeSource: 'application-utf16-lexer', sourceLines: lineIndex.length,
        headings: Object.freeze(headings), importEntries: Object.freeze(importEntries),
        metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(), tokenCount: tokens.length, nodeCount }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof TomlBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseTomlStructure = createTomlStructureParser();
