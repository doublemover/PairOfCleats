import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from './lines.js';
import { createApplicationParserLoader } from './application-parser-loader.js';

const require = createRequire(import.meta.url);
const MAX_CHARS = 786432;
const MAX_LINES = 5000;
const MAX_TOKENS = 32768;
const MAX_DEFINITIONS = 4096;
const MAX_NODES = 32768;
const KEYWORDS = Object.freeze({ ObjectType: 'type', InterfaceType: 'interface', EnumType: 'enum',
  UnionType: 'union', InputObjectType: 'input', ScalarType: 'scalar', Schema: 'schema', Directive: 'directive' });

/** Parse/lex syntax only. No schema construction, resolver execution or remote reads. */
export const createGraphqlStructureParser = ({ loadParser = () => require('graphql'), initializationNow } = {}) => {
  const loader = createApplicationParserLoader({ loadParser, isSupported: (parser) => typeof parser?.parse === 'function',
    ...(initializationNow ? { now: initializationNow } : {}) });
  let previousText;
  let previousResult;
  const parse = (text) => {
    const source = String(text || '');
    const fallback = (reason) => ({ parser: 'heuristic-graphql', coverage: 'heuristic', reason,
      definitions: [], imports: [], references: [], importEntries: [], referenceEntries: [] });
    if (source.length > MAX_CHARS) return fallback('source-limit');
    // A successful identical source already passed the fixed line/node limits
    // and initialized the app-owned parser. Avoid rebuilding its line index.
    if (source === previousText) return previousResult;
    const lineIndex = buildLineIndex(source);
    if (lineIndex.length > MAX_LINES) return fallback('line-limit');
    const initialization = loader.initialize();
    if (!initialization.available) return fallback(initialization.reason);
    const graphql = loader.getParser();
    try {
      const document = graphql.parse(source, { maxTokens: MAX_TOKENS });
      if (!Array.isArray(document.definitions) || document.definitions.length > MAX_DEFINITIONS) return fallback('definition-limit');
      const imports = new Set();
      const references = new Set();
      const importEntries = [];
      const referenceEntries = [];
      const recordEntry = (list, value, start, end) => {
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) throw new Error('Invalid source range');
        list.push(Object.freeze({ value, start, end, line: Math.max(0, offsetToLine(lineIndex, start) - 1) }));
      };
      const definitions = [];
      for (const node of document.definitions) {
        const start = node.loc?.start;
        const end = node.loc?.end;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) return fallback('invalid-source-range');
        if (definitions.length && start < definitions.at(-1).end) return fallback('invalid-source-range');
        const name = node.name?.value || '';
        const extension = node.kind.endsWith('Extension');
        const base = node.kind.replace(/(Definition|Extension)$/u, '');
        const keyword = base === 'Operation' ? node.operation : base === 'Fragment' ? 'fragment' : KEYWORDS[base];
        if (!keyword) continue;
        const definitionType = `${extension ? 'extend-' : ''}${keyword}`;
        // Preserve established directive heading titles; its real name remains metadata/relations.
        const title = `${extension ? 'extend ' : ''}${keyword}${name && keyword !== 'directive' ? ` ${name}` : ''}`;
        definitions.push(Object.freeze({ name, keyword, title, definitionType, start, end,
          // Scan-line budgets apply to the declaration, not its preceding description.
          line: Math.max(0, offsetToLine(lineIndex, node.name?.loc?.start ?? start) - 1) }));
      }
      let tokens = 0;
      for (let token = document.loc?.startToken; token; token = token.next) {
        if (++tokens > MAX_TOKENS + 2) return fallback('token-limit');
        if (token.kind !== graphql.TokenKind.COMMENT) continue;
        const match = String(token.value || '').match(/^\s*import\s+["']([^"']+)["']/u);
        if (match) {
          imports.add(match[1]);
          recordEntry(importEntries, match[1], token.start, token.end);
        }
      }
      const stack = [document];
      const seen = new Set();
      let nodes = 0;
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (++nodes > MAX_NODES) return fallback('node-limit');
        if ((node.kind === 'NamedType' || node.kind === 'FragmentSpread') && node.name?.value) {
          references.add(node.name.value);
          recordEntry(referenceEntries, node.name.value, node.loc?.start, node.loc?.end);
        }
        if (node.kind === 'Directive' && node.name?.value === 'link') {
          const url = node.arguments?.find((argument) => argument.name?.value === 'url')?.value;
          if (url?.kind === 'StringValue' && typeof url.value === 'string') {
            imports.add(url.value);
            recordEntry(importEntries, url.value, url.loc?.start, url.loc?.end);
          }
        }
        for (const [key, value] of Object.entries(node)) {
          if (key === 'loc') continue;
          if (Array.isArray(value)) stack.push(...value);
          else if (value && typeof value === 'object') stack.push(value);
        }
      }
      previousText = source;
      previousResult = Object.freeze({ parser: 'graphql-js', coverage: 'syntax-only', reason: null,
        sourceLines: lineIndex.length,
        definitions: Object.freeze(definitions), imports: Object.freeze([...imports]),
        references: Object.freeze([...references]), importEntries: Object.freeze(importEntries),
        referenceEntries: Object.freeze(referenceEntries) });
      return previousResult;
    } catch (error) {
      // The pinned 16.12 parser says "more that"; also accept the corrected wording.
      const message = String(error?.message || '');
      const tokenLimit = ['that', 'than'].some((word) => message ===
        `Syntax Error: Document contains more ${word} ${MAX_TOKENS} tokens. Parsing aborted.`);
      return fallback(tokenLimit ? 'token-limit' : 'parse-failed');
    }
  };
  parse.initialize = () => loader.initialize();
  return parse;
};

export const parseGraphqlStructure = createGraphqlStructureParser();
