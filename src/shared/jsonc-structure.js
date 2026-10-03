import { createRequire } from 'node:module';
import path from 'node:path';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';
import { JSON_REFERENCE_KEYS, JSON_REFERENCE_NODE_LIMIT, JSON_REFERENCE_VALUE_DEPTH } from './json-reference-policy.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 262144;
const MAX_LINES = 4000;
const MAX_TOKENS = 65536;
const MAX_TOKEN_CHARS = 32768;
const MAX_DEPTH = 64;
const MAX_PARSE_MS = 30;
const EMPTY = Object.freeze([]);
const REFERENCE_KEYS = new Set(JSON_REFERENCE_KEYS);
class JsoncBoundaryError extends Error {}

export const isJsoncFile = ({ ext, relPath } = {}) => String(ext
  || path.posix.extname(String(relPath || '').replace(/\\/gu, '/'))).toLowerCase() === '.jsonc';

/** JSONC syntax only; never evaluate objects, resolve schemas or load referenced files. */
export const createJsoncStructureParser = ({ loadParser = () => require('jsonc-parser'),
  initializationNow, now = () => performance.now() } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, unsupportedReason: 'parser-unsupported',
    isSupported: (parser) => typeof parser?.parseTree === 'function' && typeof parser?.createScanner === 'function'
      && typeof parser?.SyntaxKind?.EOF === 'number',
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text, { maxMs = MAX_PARSE_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let metrics = {};
    let sourceLines;
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'jsonc-unavailable', coverage: 'unavailable', reason,
      sourceLines, properties: EMPTY, importEntries: EMPTY, metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const started = Number(now());
    const configured = Number(maxMs);
    const localLimitMs = Number.isFinite(configured) && configured > 0
      ? Math.max(1, Math.min(MAX_PARSE_MS, Math.floor(configured))) : MAX_PARSE_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const entryRemaining = remaining();
    metrics = { localLimitMs, effectiveLimitMsAtEntry: Number.isFinite(entryRemaining)
      ? Math.max(0, Math.min(localLimitMs, entryRemaining)) : entryRemaining === Infinity ? localLimitMs : 0 };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      const measured = elapsed();
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) throw new JsoncBoundaryError('time-limit');
    };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      const lineIndex = buildLineIndex(source);
      sourceLines = lineIndex.length;
      checkTime();
      if (lineIndex.length > MAX_LINES) return fallback('line-limit', elapsed());
      const vendor = loader.getParser();
      const kinds = vendor.SyntaxKind;
      const scanner = vendor.createScanner(source, false);
      const nesting = [];
      let tokenCount = 0;
      for (let token = scanner.scan(); token !== kinds.EOF; token = scanner.scan()) {
        checkTime();
        if (++tokenCount > MAX_TOKENS) throw new JsoncBoundaryError('token-limit');
        if (scanner.getTokenError()) throw new JsoncBoundaryError('lexical-failed');
        if (![kinds.Trivia, kinds.LineBreakTrivia, kinds.LineCommentTrivia, kinds.BlockCommentTrivia].includes(token)
          && scanner.getTokenLength() > MAX_TOKEN_CHARS) throw new JsoncBoundaryError('token-length-limit');
        if (token === kinds.OpenBraceToken || token === kinds.OpenBracketToken) {
          if (nesting.length >= MAX_DEPTH) throw new JsoncBoundaryError('depth-limit');
          nesting.push(token);
        } else if (token === kinds.CloseBraceToken || token === kinds.CloseBracketToken) {
          if (nesting.pop() !== (token === kinds.CloseBraceToken ? kinds.OpenBraceToken : kinds.OpenBracketToken)) {
            throw new JsoncBoundaryError('unbalanced-containers');
          }
        }
      }
      checkTime();
      if (scanner.getTokenError() || nesting.length) throw new JsoncBoundaryError('lexical-failed');
      const errors = [];
      // Vendor parsing is synchronous. Depth/token/source admission precedes it;
      // measure return-time overrun rather than claim a timer can interrupt it.
      const root = vendor.parseTree(source, errors, { disallowComments: false, allowTrailingComma: true, allowEmptyContent: false });
      checkTime();
      if (errors.length || !root) throw new JsoncBoundaryError('parse-failed');
      const seen = new Set();
      const stack = [root];
      const containers = new Map();
      const rangeOf = (node) => {
        if (!Number.isInteger(node.offset) || !Number.isInteger(node.length) || node.offset < 0
          || node.length < 0 || node.offset + node.length > source.length) throw new JsoncBoundaryError('invalid-tree-range');
        return { start: node.offset, end: node.offset + node.length, line: offsetToLine(lineIndex, node.offset) - 1 };
      };
      while (stack.length) {
        checkTime();
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) throw new JsoncBoundaryError('unsupported-tree');
        seen.add(node);
        if (seen.size > JSON_REFERENCE_NODE_LIMIT) throw new JsoncBoundaryError('node-limit');
        rangeOf(node);
        if (!['object', 'array', 'property', 'string', 'number', 'boolean', 'null'].includes(node.type)) throw new JsoncBoundaryError('unsupported-tree');
        if (node.type === 'string' && typeof node.value !== 'string') throw new JsoncBoundaryError('unsupported-string');
        if (node.type === 'property' && (!Array.isArray(node.children) || node.children.length !== 2
          || node.children[0]?.type !== 'string' || typeof node.children[0].value !== 'string')) throw new JsoncBoundaryError('unsupported-property');
        if (node.type === 'object') {
          if (!Array.isArray(node.children) || node.children.some((child) => child?.type !== 'property')) throw new JsoncBoundaryError('unsupported-object');
          const effective = new Map();
          for (const property of node.children) {
            checkTime();
            const key = property.children?.[0]?.value;
            if (typeof key !== 'string') throw new JsoncBoundaryError('unsupported-property');
            effective.set(key, property); // Last key wins without materializing JavaScript objects.
          }
          containers.set(node, [...effective.values()]);
        }
        for (const child of node.children || []) {
          const range = rangeOf(child);
          if (range.start < node.offset || range.end > node.offset + node.length) throw new JsoncBoundaryError('invalid-child-range');
          stack.push(child);
        }
      }
      const properties = root.type === 'object' ? containers.get(root).map((property) => Object.freeze({
        name: property.children[0].value, ...rangeOf(property),
        keyRange: Object.freeze(rangeOf(property.children[0])) })).sort((a, b) => a.start - b.start) : [];
      const importEntries = [];
      const queue = [root];
      let referenceVisits = 0;
      const effectiveChildren = (node) => node.type === 'object' ? containers.get(node).map((property) => property.children[1])
        : node.type === 'array' ? node.children || [] : [];
      const collectValues = (value, property) => {
        const values = [{ node: value, depth: JSON_REFERENCE_VALUE_DEPTH }];
        for (let cursor = 0; cursor < values.length; cursor += 1) {
          checkTime();
          if (++referenceVisits > JSON_REFERENCE_NODE_LIMIT) throw new JsoncBoundaryError('reference-node-limit');
          const current = values[cursor];
          if (current.depth < 0) continue;
          if (current.node.type === 'string') {
            importEntries.push(Object.freeze({ value: current.node.value, ...rangeOf(current.node),
              propertyRange: Object.freeze(rangeOf(property)), keyRange: Object.freeze(rangeOf(property.children[0])) }));
          } else for (const child of effectiveChildren(current.node)) values.push({ node: child, depth: current.depth - 1 });
        }
      };
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        checkTime();
        const node = queue[cursor];
        if (node.type === 'object') for (const property of containers.get(node)) {
          checkTime();
          if (REFERENCE_KEYS.has(property.children[0].value.toLowerCase())) collectValues(property.children[1], property);
        }
        queue.push(...effectiveChildren(node));
      }
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'jsonc-parser', coverage: 'partial', reason: null, rootType: root.type,
        rangeSource: 'vendor-utf16-node', sourceLines: lineIndex.length, properties: Object.freeze(properties),
        importEntries: Object.freeze(importEntries), metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(),
          tokenCount, nodeCount: seen.size, referenceVisits }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof JsoncBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseJsoncStructure = createJsoncStructureParser();
