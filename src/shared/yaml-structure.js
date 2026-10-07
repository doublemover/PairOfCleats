import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 786432;
const MAX_LINES = 20000;
const MAX_TOKENS = 65536;
const MAX_TOKEN_CHARS = 32768;
const MAX_CST_NODES = 65536;
const MAX_NODES = 20000;
const MAX_DEPTH = 64;
const MAX_DOCUMENTS = 64;
const MAX_MS = 30;
const EMPTY = Object.freeze([]);
const REFERENCES = new Set(['include', 'includes', 'import', 'imports', 'extends', 'ref', '$ref', 'schema']);
const CORE_TAGS = new Set(['map', 'seq', 'str', 'bool', 'int', 'float', 'null'].map((tag) => `tag:yaml.org,2002:${tag}`));
class YamlBoundaryError extends Error {}

/** Public syntax nodes only; no object conversion, alias expansion or custom tags. */
export const createYamlStructureParser = ({ loadParser = () => require('yaml'),
  initializationNow, now = () => performance.now() } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, unsupportedReason: 'parser-unsupported',
    isSupported: (parser) => ['Lexer', 'Parser', 'Composer', 'isMap', 'isSeq', 'isScalar', 'isAlias'].every((key) => typeof parser?.[key] === 'function')
      && typeof parser?.CST?.tokenType === 'function' && typeof parser?.CST?.isCollection === 'function',
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text, { maxMs = MAX_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let sourceLines;
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'yaml-unavailable', coverage: 'unavailable', reason,
      sourceLines, properties: EMPTY, jobs: EMPTY, importEntries: EMPTY, documentRanges: EMPTY,
      metrics: Object.freeze({ ...metrics, elapsedMs }) });
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
      if (!Number.isFinite(measured) || measured >= localLimitMs || !(remaining() > 0)) throw new YamlBoundaryError('time-limit');
    };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      const lineIndex = buildLineIndex(source);
      sourceLines = lineIndex.length;
      checkTime();
      if (sourceLines > MAX_LINES) return fallback('line-limit', elapsed());
      const position = (start, end) => Object.freeze({ start, end, line: offsetToLine(lineIndex, start) - 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)) - 1 });
      const vendor = loader.getParser();
      const lexer = new vendor.Lexer();
      const parser = new vendor.Parser();
      const tokens = [];
      const flow = [];
      let scalarNext = false;
      let tokenCount = 0;
      for (const lexeme of lexer.lex(source)) {
        checkTime();
        if (++tokenCount > MAX_TOKENS) throw new YamlBoundaryError('token-limit');
        if (typeof lexeme !== 'string' || lexeme.length > MAX_TOKEN_CHARS) throw new YamlBoundaryError('token-length-limit');
        // The lexer explicitly marks opaque scalar source. A scalar containing
        // bracket-looking text must not consume flow nesting authority.
        if (scalarNext) scalarNext = false;
        else {
          const type = vendor.CST.tokenType(lexeme);
          if (type === 'scalar') scalarNext = true;
          if (type === 'flow-map-start' || type === 'flow-seq-start') {
            if (flow.length >= MAX_DEPTH) throw new YamlBoundaryError('depth-limit');
            flow.push(type);
          } else if (type === 'flow-map-end' || type === 'flow-seq-end') {
            if (flow.pop() !== (type === 'flow-map-end' ? 'flow-map-start' : 'flow-seq-start')) throw new YamlBoundaryError('lexical-failed');
          }
        }
        for (const token of parser.next(lexeme)) { checkTime(); tokens.push(token); }
      }
      checkTime();
      if (flow.length) throw new YamlBoundaryError('lexical-failed');
      for (const token of parser.end()) { checkTime(); tokens.push(token); }

      // Admit the public CST iteratively before the recursive document composer.
      // Parser construction and each synchronous generator advance are measured,
      // not falsely described as timer-interruptible.
      const cst = tokens.map((token) => ({ token, depth: 0 }));
      let cstNodeCount = 0;
      let documents = 0;
      while (cst.length) {
        checkTime();
        const { token, depth } = cst.pop();
        if (!token) continue;
        if (++cstNodeCount > MAX_CST_NODES) throw new YamlBoundaryError('cst-node-limit');
        if (typeof token !== 'object' || typeof token.type !== 'string') throw new YamlBoundaryError('unsupported-cst');
        if (token.type === 'error') throw new YamlBoundaryError('lexical-failed');
        if (token.type === 'document' && ++documents > MAX_DOCUMENTS) throw new YamlBoundaryError('document-limit');
        const childDepth = depth + (vendor.CST.isCollection(token) ? 1 : 0);
        if (childDepth > MAX_DEPTH) throw new YamlBoundaryError('depth-limit');
        if (token.value) cst.push({ token: token.value, depth: childDepth });
        for (const item of token.items || []) {
          if (item.key) cst.push({ token: item.key, depth: childDepth });
          if (item.value) cst.push({ token: item.value, depth: childDepth });
          for (const key of ['start', 'sep']) for (const child of item[key] || []) cst.push({ token: child, depth: childDepth });
        }
        for (const key of ['start', 'end', 'props']) {
          const children = Array.isArray(token[key]) ? token[key] : token[key] ? [token[key]] : [];
          for (const child of children) cst.push({ token: child, depth: childDepth });
        }
      }
      checkTime();
      const composer = new vendor.Composer({ schema: 'core', customTags: [], resolveKnownTags: false,
        merge: false, uniqueKeys: true, strict: true, prettyErrors: false, intAsBigInt: true });
      const parsedDocuments = [];
      for (const document of composer.compose(tokens, true, source.length)) {
        checkTime();
        if (parsedDocuments.length >= MAX_DOCUMENTS) throw new YamlBoundaryError('document-limit');
        if (document.errors?.length) throw new YamlBoundaryError('parse-failed');
        parsedDocuments.push(document);
      }
      const rangeOf = (node) => {
        const range = node?.range;
        if (!Array.isArray(range) || range.length !== 3 || range.some((value) => !Number.isInteger(value))
          || range[0] < 0 || range[1] < range[0] || range[2] < range[1] || range[2] > source.length) {
          throw new YamlBoundaryError('invalid-node-range');
        }
        return position(range[0], range[1]);
      };
      const unsupportedTag = (node) => typeof node?.tag === 'string' && !CORE_TAGS.has(node.tag);
      const keyName = (node) => vendor.isScalar(node) && !unsupportedTag(node)
        && ['string', 'number', 'bigint', 'boolean'].includes(typeof node.value) ? String(node.value) : null;
      const properties = [];
      const jobs = [];
      const importEntries = [];
      const documentRanges = [];
      const warningCodes = new Set();
      let nodeCount = 0;
      let unresolvedAliases = 0;
      let unresolvedTags = 0;
      const seen = new Set();
      for (let documentIndex = 0; documentIndex < parsedDocuments.length; documentIndex += 1) {
        checkTime();
        const document = parsedDocuments[documentIndex];
        for (const warning of document.warnings || []) {
          checkTime();
          if (typeof warning?.code === 'string') warningCodes.add(warning.code);
        }
        const documentRange = rangeOf(document);
        documentRanges.push(documentRange);
        const data = document.contents ? [{ node: document.contents, depth: 0, parent: document.range }] : [];
        while (data.length) {
          checkTime();
          const { node, depth, parent } = data.pop();
          if (++nodeCount > MAX_NODES) throw new YamlBoundaryError('node-limit');
          if (depth > MAX_DEPTH) throw new YamlBoundaryError('depth-limit');
          if (seen.has(node)) throw new YamlBoundaryError('cyclic-node');
          seen.add(node);
          const nodeRange = rangeOf(node);
          if (nodeRange.start < parent[0] || node.range[2] > parent[2]) throw new YamlBoundaryError('invalid-child-range');
          if (vendor.isAlias(node)) { unresolvedAliases += 1; continue; }
          if (unsupportedTag(node)) { unresolvedTags += 1; continue; }
          if (vendor.isScalar(node)) continue;
          if (vendor.isSeq(node)) {
            for (const child of node.items) if (child) data.push({ node: child, depth: depth + 1, parent: node.range });
            continue;
          }
          if (!vendor.isMap(node)) throw new YamlBoundaryError('unsupported-node');
          for (const pair of node.items) {
            checkTime();
            if (pair.key) data.push({ node: pair.key, depth: depth + 1, parent: node.range });
            if (pair.value) data.push({ node: pair.value, depth: depth + 1, parent: node.range });
            const name = keyName(pair.key);
            if (!name) continue;
            const keyRange = rangeOf(pair.key);
            const valueRange = pair.value ? rangeOf(pair.value) : keyRange;
            const propertyRange = position(keyRange.start, valueRange.end);
            if (node === document.contents && !node.flow && keyRange.start === lineIndex[keyRange.line]) {
              properties.push(Object.freeze({ name, keyRange, valueRange, propertyRange, documentIndex,
                sectionStart: lineIndex[keyRange.line] }));
            }
            if (node === document.contents && name === 'jobs' && vendor.isMap(pair.value)
              && !pair.value.flow && !unsupportedTag(pair.value)) {
              for (const job of pair.value.items) {
                checkTime();
                const jobName = keyName(job.key);
                if (!jobName) continue;
                const jobKey = rangeOf(job.key);
                const jobValue = job.value ? rangeOf(job.value) : jobKey;
                jobs.push(Object.freeze({ name: jobName, keyRange: jobKey, valueRange: jobValue, propertyRange: position(jobKey.start, jobValue.end),
                  documentIndex, sectionStart: lineIndex[jobKey.line] }));
              }
            }
            if (!REFERENCES.has(name.toLowerCase())) continue;
            const candidates = vendor.isSeq(pair.value) && !unsupportedTag(pair.value) ? pair.value.items : [pair.value];
            for (const candidate of candidates) {
              checkTime();
              if (!vendor.isScalar(candidate) || unsupportedTag(candidate) || typeof candidate.value !== 'string') continue;
              importEntries.push(Object.freeze({ value: candidate.value, ...rangeOf(candidate), keyRange, propertyRange, documentIndex }));
            }
          }
        }
      }
      properties.sort((left, right) => left.keyRange.start - right.keyRange.start);
      jobs.sort((left, right) => left.keyRange.start - right.keyRange.start);
      importEntries.sort((left, right) => left.start - right.start);
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'yaml-syntax-nodes', coverage: 'partial', reason: null,
        rangeSource: 'vendor-utf16-node', sourceLines, unresolvedAliases, unresolvedTags,
        warningCodes: Object.freeze([...warningCodes]),
        properties: Object.freeze(properties), jobs: Object.freeze(jobs), importEntries: Object.freeze(importEntries),
        documentRanges: Object.freeze(documentRanges),
        metrics: Object.freeze({ ...metrics, elapsedMs: elapsed(), tokenCount, cstNodeCount, nodeCount }) });
      return previousResult;
    } catch (error) {
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof YamlBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseYamlStructure = createYamlStructureParser();
