import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 786432;
const MAX_LINES = 5000;
const MAX_TOKENS = 32768;
const MAX_TOKEN_CHARS = 8192;
const MAX_NODES = 4096;
const MAX_DEPTH = 64;
const MAX_PARSE_MS = 100;
const EMPTY = Object.freeze([]);
const SCALARS = new Set(['double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string', 'bytes']);
class StructureBoundaryError extends Error {}

/** Application-owned lexical offsets. protobufjs does NOT supply these ranges. */
const lexSource = (source, checkTime) => {
  const tokens = [];
  let braces = 0;
  let offset = 0;
  const append = (kind, start, end) => {
    if (tokens.length >= MAX_TOKENS) throw new StructureBoundaryError('token-limit');
    if (end - start > MAX_TOKEN_CHARS) throw new StructureBoundaryError('token-length-limit');
    tokens.push({ kind, value: kind === 'string' ? null : source.slice(start, end), start, end });
  };
  while (offset < source.length) {
    if ((offset & 255) === 0) checkTime();
    const start = offset;
    const current = source[offset];
    if (/\s/u.test(current)) { offset += 1; continue; }
    if (current === '/' && source[offset + 1] === '/') {
      offset = source.indexOf('\n', offset + 2);
      if (offset < 0) offset = source.length;
      continue;
    }
    if (current === '/' && source[offset + 1] === '*') {
      const end = source.indexOf('*/', offset + 2);
      if (end < 0) throw new StructureBoundaryError('unterminated-comment');
      offset = end + 2;
      continue;
    }
    if (current === '"' || current === "'") {
      const quote = current;
      offset += 1;
      let closed = false;
      while (offset < source.length) {
        if ((offset & 255) === 0) checkTime();
        if (source[offset] === '\\') { offset += 2; continue; }
        if (source[offset++] === quote) { closed = true; break; }
      }
      if (!closed) throw new StructureBoundaryError('unterminated-string');
      append('string', start, offset);
      continue;
    }
    if (/[A-Za-z_]/u.test(current)) {
      offset += 1;
      while (offset < source.length && /[A-Za-z0-9_]/u.test(source[offset])) {
        if ((offset & 255) === 0) checkTime();
        offset += 1;
      }
      append('identifier', start, offset);
      continue;
    }
    offset += 1;
    if (current === '{' && ++braces > MAX_DEPTH) throw new StructureBoundaryError('depth-limit');
    if (current === '}' && --braces < 0) throw new StructureBoundaryError('unbalanced-braces');
    append('punctuation', start, offset);
  }
  if (braces) throw new StructureBoundaryError('unbalanced-braces');
  checkTime();
  return tokens;
};

/** Parse reflection only: no loading, resolution, type setup/codegen or RPC. */
export const createProtoStructureParser = ({ loadParser = () => require('protobufjs'),
  initializationNow, now = () => performance.now() } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, unsupportedReason: 'parser-unsupported',
    isSupported: (parser) => typeof parser?.parse === 'function'
      && ['Root', 'Type', 'Enum', 'Service', 'Method', 'OneOf', 'Field'].every((key) => typeof parser[key] === 'function'),
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text, { maxMs = MAX_PARSE_MS, remainingMs = null } = {}) => {
    const source = String(text || '');
    let metrics = {};
    const fallback = (reason, elapsedMs = 0) => Object.freeze({ parser: 'proto-unavailable', coverage: 'unavailable', reason,
      headings: EMPTY, definitions: EMPTY, imports: EMPTY, importEntries: EMPTY, references: EMPTY,
      metrics: Object.freeze({ ...metrics, elapsedMs }) });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    if (/\r(?!\n)/u.test(source)) return fallback('unsupported-lone-cr');
    const lineIndex = buildLineIndex(source);
    if (lineIndex.length > MAX_LINES) return fallback('line-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const started = Number(now());
    const configuredMs = Number(maxMs);
    const localLimitMs = Number.isFinite(configuredMs) && configuredMs > 0 ? Math.min(MAX_PARSE_MS, Math.floor(configuredMs)) : MAX_PARSE_MS;
    const remaining = () => typeof remainingMs === 'function' ? Number(remainingMs()) : Infinity;
    const callerRemainingAtEntry = remaining();
    metrics = { isolatedMaxMs: MAX_PARSE_MS, localLimitMs,
      effectiveLimitMsAtEntry: Number.isFinite(callerRemainingAtEntry) ? Math.max(0, Math.min(localLimitMs, callerRemainingAtEntry))
        : callerRemainingAtEntry === Infinity ? localLimitMs : 0,
      callerRemainingMsAtEntry: Number.isFinite(callerRemainingAtEntry) ? callerRemainingAtEntry : null };
    const elapsed = () => Math.max(0, Number(now()) - started);
    const checkTime = () => {
      if (elapsed() >= localLimitMs || !(remaining() > 0)) throw new StructureBoundaryError('time-limit');
    };
    try {
      checkTime();
      if (source === previousText) return previousResult;
      const tokens = lexSource(source, checkTime);
      const protobuf = loader.getParser();
      // Vendor parsing is synchronous; check its measured overrun immediately after
      // return. Source/token/depth admission bounds it before entry, not a fake timer interrupt.
      const reflected = protobuf.parse(source, { keepCase: true });
      checkTime();
      if (!(reflected?.root instanceof protobuf.Root)) return fallback('unsupported-reflection', elapsed());
      const symbols = new Map();
      const references = new Set();
      const extendTargets = new Set();
      const seen = new Set();
      const stack = [reflected.root];
      const reference = (value) => {
        if (typeof value === 'string' && value && !SCALARS.has(value)) references.add(value);
      };
      while (stack.length) {
        checkTime();
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (seen.size > MAX_NODES) throw new StructureBoundaryError('node-limit');
        let kind;
        if (node instanceof protobuf.Type) kind = 'message';
        else if (node instanceof protobuf.Enum) kind = 'enum';
        else if (node instanceof protobuf.Service) kind = 'service';
        else if (node instanceof protobuf.Method) kind = 'rpc';
        else if (node instanceof protobuf.OneOf) kind = 'oneof';
        if (kind) symbols.set(node.fullName, { name: node.name, kind, fullName: node.fullName });
        if (node instanceof protobuf.Field) {
          reference(node.type);
          if (node.extend) { extendTargets.add(node.extend.replace(/^\./u, '')); reference(node.extend); }
        }
        if (node instanceof protobuf.Method) { reference(node.requestType); reference(node.responseType); }
        for (const key of ['nested', 'fields', 'methods', 'oneofs']) {
          for (const child of Object.values(node[key] || {})) stack.push(child);
        }
      }
      const headings = [];
      const definitions = [];
      const importEntries = [];
      const imports = reflected.imports || [];
      const weakImports = reflected.weakImports || [];
      let importIndex = 0;
      let weakIndex = 0;
      const packagePath = reflected.package ? `.${reflected.package}` : '';
      const scopes = [{ kind: 'root', path: packagePath }];
      const openingScopes = new Map();
      let statementStart = true;
      const findDelimiter = (start, values) => {
        for (let index = start; index < Math.min(tokens.length, start + 256); index += 1) {
          checkTime();
          if (values.includes(tokens[index].value)) return index;
        }
        throw new StructureBoundaryError('header-token-limit');
      };
      const qualifiedName = (start) => {
        let index = start;
        let name = '';
        if (tokens[index]?.value === '.') { name = '.'; index += 1; }
        if (tokens[index]?.kind !== 'identifier') return null;
        name += tokens[index++].value;
        while (tokens[index]?.value === '.' && tokens[index + 1]?.kind === 'identifier') {
          name += `.${tokens[index + 1].value}`;
          index += 2;
        }
        return { name, next: index };
      };
      for (let index = 0; index < tokens.length; index += 1) {
        checkTime();
        const token = tokens[index];
        const scope = scopes.at(-1);
        if (token.value === '{') {
          scopes.push(openingScopes.get(index) || { kind: 'other', path: scope.path });
          statementStart = true;
          continue;
        }
        if (token.value === '}') { scopes.pop(); statementStart = true; continue; }
        if (token.value === ';') { statementStart = true; continue; }
        if (!statementStart || token.kind !== 'identifier') { statementStart = false; continue; }
        statementStart = false;
        const keyword = token.value;
        if (scope.kind === 'root' && keyword === 'import') {
          const modifier = tokens[index + 1]?.value;
          if (modifier === 'option') throw new StructureBoundaryError('unsupported-option-import');
          const value = modifier === 'weak' ? weakImports[weakIndex++] : imports[importIndex++];
          if (typeof value !== 'string') throw new StructureBoundaryError('reflection-lexical-mismatch');
          importEntries.push(Object.freeze({ value, start: token.start, line: offsetToLine(lineIndex, token.start) - 1 }));
          continue;
        }
        let heading;
        if (scope.kind === 'root' && ['syntax', 'edition', 'package'].includes(keyword)) {
          const endToken = tokens[findDelimiter(index + 1, [';'])];
          heading = { name: keyword === 'package' ? `package ${reflected.package}` : keyword,
            keyword, start: token.start, end: endToken.end, reflectionName: keyword === 'package' ? reflected.package : null };
        } else if (['root', 'message', 'service'].includes(scope.kind)) {
          const declared = qualifiedName(index + 1);
          if (!declared) continue;
          if (keyword === 'extend') {
            if (!extendTargets.has(declared.name.replace(/^\./u, '')) || tokens[declared.next]?.value !== '{') continue;
            heading = { name: `extend ${declared.name}`, keyword, start: token.start, end: tokens[declared.next].end,
              reflectionName: declared.name };
            openingScopes.set(declared.next, { kind: 'extend', path: scope.path });
          } else {
            const fullName = `${scope.path}.${declared.name}`;
            const symbol = symbols.get(fullName);
            if (!symbol || symbol.kind !== keyword) continue;
            const opening = keyword === 'rpc' ? findDelimiter(declared.next, ['{', ';']) : declared.next;
            if (opening < 0 || !['{', ';'].includes(tokens[opening]?.value)) continue;
            heading = { name: `${keyword} ${declared.name}`, keyword, start: token.start,
              end: tokens[opening].end, reflectionName: fullName };
            if (tokens[opening].value === '{') openingScopes.set(opening, { kind: keyword, path: fullName });
            if (keyword !== 'oneof') definitions.push(Object.freeze({ name: symbol.name,
              fullName, line: offsetToLine(lineIndex, token.start) - 1 }));
          }
        }
        if (heading) headings.push(Object.freeze({ ...heading, line: offsetToLine(lineIndex, token.start) - 1 }));
      }
      if (importIndex !== imports.length || weakIndex !== weakImports.length) throw new StructureBoundaryError('reflection-lexical-mismatch');
      checkTime();
      previousText = source;
      previousResult = Object.freeze({ parser: 'protobufjs-reflection', coverage: 'partial', reason: null,
        rangeSource: 'application-lexer', sourceLines: lineIndex.length,
        headings: Object.freeze(headings), definitions: Object.freeze(definitions),
        imports: Object.freeze(importEntries.map((entry) => entry.value)), importEntries: Object.freeze(importEntries),
        references: Object.freeze([...references]), metrics: Object.freeze({ elapsedMs: elapsed(),
          ...metrics, tokenCount: tokens.length, reflectionNodes: seen.size }) });
      return previousResult;
    } catch (error) {
      const callerRemainingAfterWork = remaining();
      metrics.callerRemainingMsAfterWork = Number.isFinite(callerRemainingAfterWork) ? callerRemainingAfterWork : null;
      metrics.measuredLocalOverrunMs = Math.max(0, elapsed() - localLimitMs);
      metrics.measuredOverrunMs = Math.max(0, elapsed() - metrics.effectiveLimitMsAtEntry);
      return fallback(error instanceof StructureBoundaryError ? error.message : 'parse-failed', elapsed());
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseProtoStructure = createProtoStructureParser();
