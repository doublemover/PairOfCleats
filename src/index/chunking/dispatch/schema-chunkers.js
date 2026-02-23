import { buildChunksFromLineHeadings } from '../helpers.js';
import { MAX_REGEX_LINE, splitLinesWithIndex } from './shared.js';

const PROTO_BLOCK_RX = /^\s*(message|enum|service|oneof)\s+([A-Za-z_][A-Za-z0-9_]*)/;
// `extend` targets may be fully qualified (for example
// `extend google.protobuf.MessageOptions`), so allow dotted paths and an
// optional leading dot for package-qualified symbols.
const PROTO_EXTEND_RX = /^\s*extend\s+(\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/;
const PROTO_RPC_RX = /^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const PROTO_SYNTAX_RX = /^\s*syntax\s*=\s*["'][^"']+["']\s*;/;
const PROTO_PACKAGE_RX = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/;
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

const hasProtoCandidate = (line) => (
  line.includes('message')
  || line.includes('enum')
  || line.includes('service')
  || line.includes('extend')
  || line.includes('oneof')
  || line.includes('rpc')
);

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
 * Heuristic Proto splitter for declaration boundaries.
 *
 * This is used when tree-sitter chunks are unavailable and must remain stable
 * across runs for scheduler fallback parity.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<object>}
 */
export const chunkProto = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    if (PROTO_SYNTAX_RX.test(line)) {
      headings.push({ line: i, title: 'syntax', kind: 'ConfigDeclaration', definitionType: 'syntax' });
      continue;
    }
    const packageMatch = line.match(PROTO_PACKAGE_RX);
    if (packageMatch) {
      headings.push({
        line: i,
        title: `package ${packageMatch[1]}`,
        kind: 'NamespaceDeclaration',
        definitionType: 'package'
      });
      continue;
    }
    if (!hasProtoCandidate(line)) continue;
    const rpcMatch = line.match(PROTO_RPC_RX);
    if (rpcMatch) {
      headings.push({
        line: i,
        title: `rpc ${rpcMatch[1]}`,
        kind: 'MethodDeclaration',
        definitionType: 'rpc'
      });
      continue;
    }
    const extendMatch = line.match(PROTO_EXTEND_RX);
    if (extendMatch) {
      const name = extendMatch[1];
      headings.push({
        line: i,
        title: `extend ${name}`,
        kind: 'ExtendDeclaration',
        definitionType: 'extend'
      });
      continue;
    }
    const blockMatch = line.match(PROTO_BLOCK_RX);
    if (blockMatch) {
      const keyword = blockMatch[1];
      const name = blockMatch[2];
      headings.push({
        line: i,
        title: `${keyword} ${name}`.trim(),
        kind: PROTO_KIND_BY_KEYWORD[keyword] || 'Section',
        definitionType: keyword
      });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return mapChunksWithSchemaMeta(chunks, headings, 'proto');
  }
  return buildFallbackChunk(text, 'proto', 'proto');
};

/**
 * Heuristic GraphQL splitter for schema/type/operation boundaries.
 *
 * This fallback intentionally tracks `extend` and operation declarations to
 * preserve deterministic chunk identity when parser-backed chunking is absent.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<object>}
 */
export const chunkGraphql = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (!hasGraphqlCandidate(line)) continue;
    const extendMatch = line.match(GRAPHQL_EXTEND_RX);
    if (extendMatch) {
      const definitionType = `extend-${extendMatch[1]}`;
      const title = extendMatch[2]
        ? `extend ${extendMatch[1]} ${extendMatch[2]}`
        : `extend ${extendMatch[1]}`;
      headings.push({
        line: i,
        title,
        kind: GRAPHQL_KIND_BY_KEYWORD[extendMatch[1]] || 'Section',
        definitionType
      });
      continue;
    }
    const operationMatch = line.match(GRAPHQL_OPERATION_RX);
    if (operationMatch) {
      const definitionType = operationMatch[1];
      const title = `${definitionType} ${operationMatch[2]}`;
      headings.push({
        line: i,
        title,
        kind: GRAPHQL_KIND_BY_KEYWORD[definitionType] || 'Section',
        definitionType
      });
      continue;
    }
    const blockMatch = line.match(GRAPHQL_BLOCK_RX);
    if (blockMatch) {
      const definitionType = blockMatch[1];
      const name = blockMatch[2] || '';
      const title = name ? `${definitionType} ${name}` : definitionType;
      headings.push({
        line: i,
        title,
        kind: GRAPHQL_KIND_BY_KEYWORD[definitionType] || 'Section',
        definitionType
      });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return mapChunksWithSchemaMeta(chunks, headings, 'graphql');
  }
  return buildFallbackChunk(text, 'graphql', 'graphql');
};
