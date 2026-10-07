import assert from 'node:assert/strict';
import { createGraphqlStructureParser, parseGraphqlStructure } from '../../../src/shared/graphql-ast.js';
import { chunkGraphql, createGraphqlChunker } from '../../../src/index/chunking/dispatch/schema-chunkers.js';
import { collectGraphqlImports, createGraphqlImportCollector } from '../../../src/index/language-registry/import-collectors/graphql.js';
import { createGraphqlManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const text = [
  '# import "common.graphql"',
  '"""',
  'Emoji 🚀 documentation:',
  'type Phantom { field: String }',
  'query Ghost { field }',
  '# import "false-dependency.graphql"',
  '@link(url: "https://example.invalid/false")',
  '"""',
  'type Real { title: String child: Child }',
  'type Child { id: ID! }',
  'extend schema @link(url: "https://example.invalid/real")',
  'query Find { real { ...Brief } }',
  'fragment Brief on Real { title }',
  ''
].join('\n');
const structure = parseGraphqlStructure(text);
assert.equal(structure.parser, 'graphql-js');
assert.equal(structure.coverage, 'syntax-only');
assert.deepEqual(structure.definitions.map((row) => row.name), ['Real', 'Child', '', 'Find', 'Brief']);
assert.deepEqual(structure.imports, ['common.graphql', 'https://example.invalid/real']);
assert.equal(parseGraphqlStructure(text), structure, 'one immutable bounded result is shared across core owners');
assert.ok(Object.isFrozen(structure.definitions));
const chunks = chunkGraphql(text);
assert.deepEqual(chunks.map((chunk) => chunk.name), ['type Real', 'type Child', 'extend schema', 'query Find', 'fragment Brief']);
assert.ok(text.slice(chunks[0].meta.astRange.start, chunks[0].meta.astRange.end).startsWith('"""'));
assert.ok(text.slice(chunks[0].start, chunks[0].end).includes('Emoji 🚀'));
assert.equal(text.slice(chunks[1].meta.astRange.start, chunks[1].meta.astRange.end), 'type Child { id: ID! }');
assert.ok(chunks.every((chunk) => chunk.meta.parserCoverage === 'syntax-only'
  && chunk.start <= chunk.meta.astRange.start && chunk.end >= chunk.meta.astRange.end));
assert.deepEqual(collectGraphqlImports(text), ['common.graphql', 'https://example.invalid/real']);
const adapter = createGraphqlManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.exports, ['Brief', 'Child', 'Find', 'Real']);
assert.deepEqual(relations.imports, ['common.graphql', 'https://example.invalid/real']);
assert.ok(relations.usages.includes('Brief') && relations.usages.includes('Child'));
assert.ok(!relations.exports.includes('Phantom') && !relations.exports.includes('Ghost'));
assert.ok(relations.calls.every((edge) => !edge.includes('Phantom') && !edge.includes('Ghost')));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.equal(adapter.extractDocMeta({ chunk: chunks[0] }).source, 'managed-graphql-syntax');

const sameLine = 'type A { id: ID } type B { value: String }';
const sameLineChunks = chunkGraphql(sameLine);
assert.deepEqual(sameLineChunks.map((chunk) => chunk.name), ['type A', 'type B']);
assert.ok(sameLineChunks.every((chunk) => chunk.end > chunk.start && chunk.end >= chunk.meta.astRange.end));
assert.equal(sameLine.slice(sameLineChunks[1].start, sameLineChunks[1].meta.astRange.end), 'type B { value: String }');
const extensions = 'extend schema { query: Query }\r\nextend type Query { ping: String }\r\n';
assert.deepEqual(chunkGraphql(extensions).map((chunk) => [chunk.name, chunk.kind]),
  [['extend schema', 'SchemaDeclaration'], ['extend type Query', 'TypeDeclaration']]);
assert.equal(chunkGraphql('{ __typename }')[0].kind, 'OperationDeclaration');
assert.equal(chunkGraphql('directive @tag on FIELD_DEFINITION')[0].meta.definitionName, 'tag');

const malformed = 'type Broken {';
assert.doesNotThrow(() => chunkGraphql(malformed));
assert.equal(chunkGraphql(malformed)[0].meta.parserCoverage, 'heuristic');
assert.equal(chunkGraphql(malformed)[0].meta.parserFallbackReason, 'parse-failed');
let loads = 0;
const unavailable = createGraphqlStructureParser({ loadParser: () => { loads += 1; throw new Error('Controlled missing parser'); } });
const fallback = createGraphqlChunker({ parseStructure: unavailable })('type A { id: ID }');
assert.equal(fallback[0].meta.parser, 'heuristic-graphql');
assert.equal(fallback[0].meta.astRange, undefined);
assert.equal(fallback[0].meta.parserFallbackReason, 'parser-unavailable');
const missingImports = createGraphqlImportCollector({ parseStructure: unavailable });
assert.deepEqual(missingImports('# import "common.graphql"\ntype A { id: ID }'), ['common.graphql']);
assert.deepEqual(createGraphqlManagedAdapter({ parseStructure: unavailable }).buildRelations({
  text: 'type A { id: ID }', options: {} }).exports, ['A']);
assert.equal(loads, 1);
assert.equal(parseGraphqlStructure('x'.repeat(786433)).reason, 'source-limit');
assert.equal(parseGraphqlStructure('\n'.repeat(5001)).reason, 'line-limit');
assert.equal(parseGraphqlStructure('query Q { ' + 'field '.repeat(32769) + '}').reason, 'token-limit');
assert.equal(parseGraphqlStructure('scalar X\n'.repeat(4097)).reason, 'definition-limit');
assert.equal(parseGraphqlStructure('type T { ' + Array.from({ length: 8193 }, (_, index) => `f${index}:T`).join(' ') + ' }').reason, 'node-limit');
const limited = { collectorScanBudget: { maxMatches: 1, maxTokens: 8, maxMs: 0 } };
assert.deepEqual(collectGraphqlImports(text, limited), ['common.graphql']);
assert.deepEqual(adapter.buildRelations({ text, options: limited }).exports, ['Real']);
const firstLine = { collectorScanBudget: { maxLines: 1, maxMs: 0 } };
assert.deepEqual(collectGraphqlImports(text, firstLine), ['common.graphql']);
const firstLineRelations = adapter.buildRelations({ text, options: firstLine });
assert.deepEqual(firstLineRelations.exports, []);
assert.deepEqual(firstLineRelations.usages, []);
assert.deepEqual(adapter.buildRelations({ text, options: {
  collectorScanBudget: { maxLines: 2, maxMs: 0 }
} }).exports, [], 'a description inside the scan budget does not admit a later declaration');
const invalid = createGraphqlStructureParser({ loadParser: () => ({ parse: () => ({ definitions: [{
  kind: 'ObjectTypeDefinition', name: { value: 'Fake' }, loc: { start: -1, end: 100 }
}] }) }) });
assert.equal(invalid('type A { id: ID }').reason, 'invalid-source-range');
console.log('GraphQL syntax owners exclude block-string phantoms and preserve UTF-16 ranges with bounded honest fallback');
