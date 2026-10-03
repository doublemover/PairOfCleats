import { buildChunksFromLineHeadings } from '../helpers.js';
import { collectHeadingRows } from './shared.js';
import { parseGraphqlStructure } from '../../../shared/graphql-ast.js';
import { parseProtoStructure } from '../../../shared/proto-structure.js';

const PROTO_KIND_BY_KEYWORD = {
  message: 'TypeDeclaration',
  enum: 'EnumDeclaration',
  service: 'ServiceDeclaration',
  extend: 'ExtendDeclaration',
  oneof: 'OneOfDeclaration'
};

const GRAPHQL_BLOCK_RX = /^\s*(schema|type|interface|enum|union|input|scalar|directive|fragment)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/;
const GRAPHQL_OPERATION_RX = /^\s*(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/;
// GraphQL allows both `extend type Name` and `extend schema { ... }` with
// no schema identifier.
const GRAPHQL_EXTEND_RX = /^\s*extend\s+(schema|type|interface|enum|union|input|scalar)\b(?:\s+([A-Za-z_][A-Za-z0-9_]*))?/;
const GRAPHQL_KIND_BY_KEYWORD = {
  schema: 'SchemaDeclaration',
  type: 'TypeDeclaration',
  interface: 'InterfaceDeclaration',
  enum: 'EnumDeclaration',
  union: 'UnionDeclaration',
  input: 'InputDeclaration',
  scalar: 'ScalarDeclaration',
  directive: 'DirectiveDeclaration',
  fragment: 'FragmentDeclaration',
  query: 'OperationDeclaration',
  mutation: 'OperationDeclaration',
  subscription: 'OperationDeclaration'
};

const hasGraphqlCandidate = (line) => (
  line.includes('schema')
  || line.includes('type')
  || line.includes('interface')
  || line.includes('enum')
  || line.includes('union')
  || line.includes('input')
  || line.includes('scalar')
  || line.includes('directive')
  || line.includes('fragment')
  || line.includes('query')
  || line.includes('mutation')
  || line.includes('subscription')
  || line.includes('extend')
);

/**
 * Project heading metadata onto chunk rows produced from heading boundaries.
 *
 * Heading and chunk arrays are expected to stay index-aligned because they are
 * produced from the same heading list. Missing headings degrade to generic
 * section metadata instead of dropping chunk rows.
 *
 * @param {Array<object>} chunks
 * @param {Array<{kind?:string,definitionType?:string}>} headings
 * @param {'proto'|'graphql'} format
 * @returns {Array<object>}
 */
const mapChunksWithSchemaMeta = (chunks, headings, format) => {
  const output = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const heading = headings[i] || null;
    output[i] = {
      ...chunk,
      kind: heading?.kind || 'Section',
      meta: {
        ...(chunk.meta || {}),
        format,
        definitionType: heading?.definitionType || null
      }
    };
  }
  return output;
};

/**
 * Full-file fallback emitted when no schema declarations are detected.
 *
 * @param {string} text
 * @param {string} name
 * @param {'proto'|'graphql'} format
 * @returns {Array<{start:number,end:number,name:string,kind:'Section',meta:{format:string}}>}
 */
const buildFallbackChunk = (text, name, format) => [{
  start: 0,
  end: text.length,
  name,
  kind: 'Section',
  meta: { format }
}];

/**
 * Verified reflection identities with application-owned lexical heading ranges.
 * Failed/unavailable parsing yields only a labelled generic section, never regex phantoms.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<object>}
 */
export const createProtoChunker = ({ parseStructure = parseProtoStructure } = {}) => (text, context = null) => {
  const source = String(text || '');
  const treeSitter = context?.treeSitter;
  const configuredMs = treeSitter?.byLanguage?.proto?.maxParseMs ?? treeSitter?.maxParseMs;
  const structure = parseStructure(source, { maxMs: configuredMs });
  if (!structure.headings.length) return buildFallbackChunk(source, 'proto', 'proto').map((chunk) => ({ ...chunk,
    meta: { ...chunk.meta, parser: structure.parser, parserCoverage: structure.coverage,
      parserFallbackReason: structure.reason } }));
  return structure.headings.map((heading, index) => ({ start: heading.start,
    end: structure.headings[index + 1]?.start ?? source.length, name: heading.name,
    kind: ['syntax', 'edition'].includes(heading.keyword) ? 'ConfigDeclaration'
      : heading.keyword === 'package' ? 'NamespaceDeclaration'
        : heading.keyword === 'rpc' ? 'MethodDeclaration' : PROTO_KIND_BY_KEYWORD[heading.keyword] || 'Section',
    meta: { title: heading.name, format: 'proto', definitionType: heading.keyword,
      parser: structure.parser, parserCoverage: structure.coverage, reflectionName: heading.reflectionName,
      rangeSource: structure.rangeSource, lexicalRange: { start: heading.start, end: heading.end },
      parseMetrics: structure.metrics } }));
};

export const chunkProto = createProtoChunker();

/**
 * GraphQL syntax definitions own exact source offsets, including descriptions
 * and multiple definitions on one line. Unsupported parsing is explicitly heuristic.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<object>}
 */
export const createGraphqlChunker = ({ parseStructure = parseGraphqlStructure } = {}) => (text, context = null) => {
  const structure = parseStructure(text);
  if (structure.parser === 'graphql-js') {
    if (!structure.definitions.length) return buildFallbackChunk(text, 'graphql', 'graphql')
      .map((chunk) => ({ ...chunk, meta: { ...chunk.meta, parser: structure.parser, parserCoverage: structure.coverage } }));
    return structure.definitions.map((definition, index) => ({ start: definition.start,
      end: structure.definitions[index + 1]?.start ?? text.length, name: definition.title,
      kind: GRAPHQL_KIND_BY_KEYWORD[definition.keyword] || 'Section', meta: { title: definition.title,
        format: 'graphql', definitionType: definition.definitionType, definitionName: definition.name || null,
        parser: structure.parser, parserCoverage: structure.coverage,
        astRange: { start: definition.start, end: definition.end } } }));
  }
  const { headings, lineIndex } = collectHeadingRows(text, context, {
    skipLine: (line, trimmed) => trimmed.startsWith('#'),
    precheck: (line) => hasGraphqlCandidate(line),
    collect: (line, trimmed, i) => {
      void trimmed;
      const extendMatch = line.match(GRAPHQL_EXTEND_RX);
      if (extendMatch) {
        const definitionType = `extend-${extendMatch[1]}`;
        const title = extendMatch[2]
          ? `extend ${extendMatch[1]} ${extendMatch[2]}`
          : `extend ${extendMatch[1]}`;
        return {
          line: i,
          title,
          kind: GRAPHQL_KIND_BY_KEYWORD[extendMatch[1]] || 'Section',
          definitionType
        };
      }
      const operationMatch = line.match(GRAPHQL_OPERATION_RX);
      if (operationMatch) {
        const definitionType = operationMatch[1];
        const title = `${definitionType} ${operationMatch[2]}`;
        return {
          line: i,
          title,
          kind: GRAPHQL_KIND_BY_KEYWORD[definitionType] || 'Section',
          definitionType
        };
      }
      const blockMatch = line.match(GRAPHQL_BLOCK_RX);
      if (blockMatch) {
        const definitionType = blockMatch[1];
        const name = blockMatch[2] || '';
        const title = name ? `${definitionType} ${name}` : definitionType;
        return {
          line: i,
          title,
          kind: GRAPHQL_KIND_BY_KEYWORD[definitionType] || 'Section',
          definitionType
        };
      }
      return null;
    }
  });
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return mapChunksWithSchemaMeta(chunks, headings, 'graphql').map((chunk) => ({ ...chunk,
      meta: { ...chunk.meta, parser: structure.parser, parserCoverage: structure.coverage, parserFallbackReason: structure.reason } }));
  }
  return buildFallbackChunk(text, 'graphql', 'graphql').map((chunk) => ({ ...chunk,
    meta: { ...chunk.meta, parser: structure.parser, parserCoverage: structure.coverage, parserFallbackReason: structure.reason } }));
};

export const chunkGraphql = createGraphqlChunker();
