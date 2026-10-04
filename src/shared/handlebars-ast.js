import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 524288;
const MAX_LINES = 3000;
const MAX_NODES = 32768;
const MAX_DEPTH = 128;
const MAX_ENTRIES = 4096;
const MAX_NAME_LENGTH = 4096;
const BLOCK_TYPES = new Set(['BlockStatement', 'PartialBlockStatement', 'DecoratorBlock']);
class ParserBoundaryError extends Error {}

// The vendor counts CRLF, bare CR and LF as newlines, and columns as UTF-16 units.
const buildSourceLines = (source) => {
  const starts = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === '\r') {
      if (source[offset + 1] === '\n') offset += 1;
      starts.push(offset + 1);
    } else if (source[offset] === '\n') starts.push(offset + 1);
  }
  return starts;
};

/** Parse syntax only. Never compile/render templates, evaluate helpers or resolve files. */
export const createHandlebarsStructureParser = ({ loadParser = () =>
  // Node >=24.15.0 supports synchronous ESM. The package's require export is broken;
  // use its public import export from this application-owned module, not a private path.
  require(fileURLToPath(import.meta.resolve('@handlebars/parser'))), initializationNow } = {}) => {
  const loader = createApplicationParserLoader({ loadParser,
    isSupported: (parser) => typeof parser?.parseWithoutProcessing === 'function', unsupportedReason: 'parser-unsupported',
    classifyError: (error) => ['ERR_REQUIRE_ASYNC_MODULE', 'ERR_REQUIRE_ESM'].includes(error?.code)
      ? 'parser-unsupported' : 'parser-unavailable', ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text) => {
    const source = String(text || '');
    const fallback = (reason) => ({ parser: 'heuristic-handlebars', coverage: 'heuristic', reason,
      blocks: [], definitions: [], partials: [], imports: [], referenceEntries: [] });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    // Reuse only a previously successful immutable model. Its identical source
    // already passed the fixed line/node limits and parser initialization.
    if (source === previousText) return previousResult;
    const lines = buildSourceLines(source);
    if (lines.length > MAX_LINES) return fallback('line-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const parser = loader.getParser();
    try {
      const document = parser.parseWithoutProcessing(source);
      if (document?.type !== 'Program' || !Array.isArray(document.body)) return fallback('unsupported-ast');
      const positionOffset = (position) => {
        const line = position?.line;
        const column = position?.column;
        if (!Number.isInteger(line) || line < 1 || line > lines.length || !Number.isInteger(column) || column < 0) {
          throw new ParserBoundaryError('invalid-source-range');
        }
        let lineEnd = lines[line] ?? source.length;
        while (lineEnd > lines[line - 1] && /[\r\n]/u.test(source[lineEnd - 1])) lineEnd -= 1;
        if (column > lineEnd - lines[line - 1]) throw new ParserBoundaryError('invalid-source-range');
        return lines[line - 1] + column;
      };
      const rangeOf = (node) => {
        const start = positionOffset(node.loc?.start);
        const end = positionOffset(node.loc?.end);
        if (end < start) throw new ParserBoundaryError('invalid-source-range');
        return { start, end, line: node.loc.start.line - 1 };
      };
      const blocks = [];
      const definitions = [];
      const partials = [];
      const referenceEntries = [];
      const imports = new Set();
      const append = (list, entry) => {
        if (list.length >= MAX_ENTRIES) throw new ParserBoundaryError('entry-limit');
        if ((entry.value ?? entry.name ?? '').length > MAX_NAME_LENGTH) throw new ParserBoundaryError('name-limit');
        list.push(Object.freeze(entry));
      };
      const inlineName = (node) => node.type === 'DecoratorBlock' && node.path?.original === 'inline'
        && node.params?.[0]?.type === 'StringLiteral' ? node.params[0].value : null;
      const isLocalPartial = (name, scope) => {
        for (let current = scope; current; current = current.parent) {
          if (current.names.has(name)) return true;
        }
        return false;
      };
      const stack = [{ node: document, depth: 0, blockDepth: 0, scope: null }];
      const seen = new Set();
      while (stack.length) {
        const frame = stack.pop();
        const { node, depth, blockDepth } = frame;
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (seen.size > MAX_NODES) throw new ParserBoundaryError('node-limit');
        if (depth > MAX_DEPTH) throw new ParserBoundaryError('depth-limit');
        let scope = frame.scope;
        if (node.type === 'Program') {
          const names = new Set();
          for (const child of node.body || []) {
            const name = inlineName(child);
            if (typeof name === 'string') names.add(name);
          }
          scope = { names, parent: scope };
        }
        const localDefinition = inlineName(node);
        if (typeof localDefinition === 'string') append(definitions, { name: localDefinition, ...rangeOf(node) });
        const isBlock = BLOCK_TYPES.has(node.type);
        if (isBlock && blockDepth === 0) {
          const name = localDefinition === null ? node.path?.original ?? node.name?.original ?? node.name?.value : `inline ${localDefinition}`;
          append(blocks, { name: String(name || 'dynamic partial'), definitionType: node.type, ...rangeOf(node) });
        }
        if (node.type === 'PartialStatement' || node.type === 'PartialBlockStatement') {
          const expression = node.name;
          let name = null;
          if (expression?.type === 'StringLiteral') name = expression.value;
          else if (expression?.type === 'PathExpression' && !expression.data && !expression.this && expression.depth === 0) name = expression.original;
          const internal = expression?.original === '@partial-block';
          const local = typeof name === 'string' && isLocalPartial(name, scope);
          const kind = internal ? 'internal' : typeof name === 'string' ? local ? 'inline' : 'static' : 'dynamic';
          append(partials, { name, kind, ...rangeOf(node) });
          if (kind === 'static') imports.add(name);
          if (typeof name === 'string' && expression.type === 'StringLiteral') {
            append(referenceEntries, { value: name, ...rangeOf(expression) });
          }
        }
        if (node.type === 'PathExpression' && typeof node.original === 'string' && node.parts?.length) {
          append(referenceEntries, { value: node.original, ...rangeOf(node) });
        }
        for (const [key, value] of Object.entries(node)) {
          if (key === 'loc') continue;
          const next = { depth: depth + 1, blockDepth: blockDepth + (isBlock ? 1 : 0), scope };
          if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ node: value[index], ...next });
          } else if (value && typeof value === 'object') stack.push({ node: value, ...next });
        }
      }
      blocks.sort((left, right) => left.start - right.start);
      definitions.sort((left, right) => left.start - right.start);
      partials.sort((left, right) => left.start - right.start);
      referenceEntries.sort((left, right) => left.start - right.start);
      for (let index = 1; index < blocks.length; index += 1) {
        if (blocks[index].start < blocks[index - 1].end) return fallback('invalid-source-range');
      }
      previousText = source;
      previousResult = Object.freeze({ parser: 'handlebars-parser', coverage: 'syntax-only', reason: null,
        sourceLines: lines.length, blocks: Object.freeze(blocks), definitions: Object.freeze(definitions),
        partials: Object.freeze(partials), imports: Object.freeze([...imports]), referenceEntries: Object.freeze(referenceEntries) });
      return previousResult;
    } catch (error) {
      return fallback(error instanceof ParserBoundaryError ? error.message : 'parse-failed');
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseHandlebarsStructure = createHandlebarsStructureParser();
