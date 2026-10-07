import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 196608;
const MAX_LINES = 3000;
const MAX_TOKENS = 16384;
const MAX_NODES = 4096;
const MAX_DEPTH = 128;
const MAX_NAME_CHARS = 4096;
const MAX_PARSE_MS = 30;
const EMPTY = Object.freeze([]);
const DEFAULT_TAGS = Object.freeze(['{{', '}}']);
const TOKEN_TYPES = new Set(['text', 'name', '&', '#', '^', '>', '!', '=']);
class StructureBoundaryError extends Error {}

const loadOwnedWriter = () => {
  const vendor = require('mustache');
  const writer = new vendor.Writer();
  // The vendor's default writer cache retains every source. Own one parse-only
  // writer instead, with no vendor cache, rendering, view lookup or partial loading.
  writer.templateCache = undefined;
  return writer;
};

/** Public parse tokens only. No template execution or semantic resolution. */
export const createMustacheStructureParser = ({ loadParser = loadOwnedWriter,
  initializationNow, now = () => performance.now() } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, unsupportedReason: 'parser-unsupported',
    isSupported: (writer) => typeof writer?.parse === 'function',
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text, { maxMs = MAX_PARSE_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'mustache-unavailable', coverage: 'unavailable', reason,
      blocks: EMPTY, sections: EMPTY, partials: EMPTY, referenceEntries: EMPTY,
      metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const started = Number(now());
    const configured = Number(maxMs);
    const localLimitMs = Number.isFinite(configured) && configured > 0
      ? Math.max(1, Math.min(MAX_PARSE_MS, Math.floor(configured))) : MAX_PARSE_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const entryRemaining = remaining();
    metrics = { isolatedMaxMs: MAX_PARSE_MS, localLimitMs,
      effectiveLimitMsAtEntry: Number.isFinite(entryRemaining) ? Math.max(0, Math.min(localLimitMs, entryRemaining))
        : entryRemaining === Infinity ? localLimitMs : 0 };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      const measured = elapsed();
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) {
        throw new StructureBoundaryError('time-limit');
      }
    };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      const lineIndex = buildLineIndex(source);
      checkTime();
      if (lineIndex.length > MAX_LINES) return fallback('line-limit', elapsed());
      const writer = loader.getParser();
      writer.templateCache = undefined;
      // Synchronous vendor parsing cannot be interrupted by a timer. Source
      // admission bounds its intermediate allocation; post-call checks measure
      // overrun, and returned token/node/depth bounds govern model extraction.
      const document = writer.parse(source, DEFAULT_TAGS);
      checkTime();
      if (!Array.isArray(document)) return fallback('unsupported-tokens', elapsed());
      const blocks = [];
      const sections = [];
      const partials = [];
      const referenceEntries = [];
      const stack = [{ tokens: document, depth: 0 }];
      const seen = new Set();
      let tokenCount = 0;
      let nodeCount = 0;
      const rangeOf = (token) => {
        const start = token[2];
        const end = token[3];
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
          throw new StructureBoundaryError('invalid-token-range');
        }
        return { start, end, line: offsetToLine(lineIndex, start) - 1 };
      };
      while (stack.length) {
        const { tokens, depth } = stack.pop();
        if (depth > MAX_DEPTH) throw new StructureBoundaryError('depth-limit');
        for (const token of tokens) {
          checkTime();
          if (!Array.isArray(token) || seen.has(token) || !TOKEN_TYPES.has(token[0]) || typeof token[1] !== 'string') {
            throw new StructureBoundaryError('unsupported-tokens');
          }
          seen.add(token);
          if (++tokenCount > MAX_TOKENS) throw new StructureBoundaryError('token-limit');
          if (token[0] === 'text' || token[0] === '!' || token[0] === '=') continue;
          if (++nodeCount > MAX_NODES) throw new StructureBoundaryError('node-limit');
          if (token[1].length > MAX_NAME_CHARS) throw new StructureBoundaryError('name-limit');
          const range = rangeOf(token);
          const name = token[1];
          if (token[0] === '#' || token[0] === '^') {
            const closeStart = token[5];
            if (!Array.isArray(token[4]) || !Number.isInteger(closeStart) || closeStart < range.end || closeStart > source.length) {
              throw new StructureBoundaryError('invalid-section-range');
            }
            const section = Object.freeze({ name, type: token[0], ...range, closeStart });
            sections.push(section);
            if (depth === 0) blocks.push(section);
            stack.push({ tokens: token[4], depth: depth + 1 });
          } else if (token[0] === '>') partials.push(Object.freeze({ name, ...range }));
          referenceEntries.push(Object.freeze({ value: name, type: token[0], ...range }));
        }
      }
      for (const entries of [blocks, sections, partials, referenceEntries]) entries.sort((a, b) => a.start - b.start);
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'mustache-parse-tokens', coverage: 'partial', reason: null,
        rangeSource: 'vendor-utf16-token', sourceLines: lineIndex.length,
        blocks: Object.freeze(blocks), sections: Object.freeze(sections), partials: Object.freeze(partials),
        referenceEntries: Object.freeze(referenceEntries),
        metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(), tokenCount, nodeCount }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof StructureBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseMustacheStructure = createMustacheStructureParser();
