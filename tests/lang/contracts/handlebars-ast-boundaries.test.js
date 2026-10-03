import assert from 'node:assert/strict';
import { createHandlebarsStructureParser, parseHandlebarsStructure } from '../../../src/shared/handlebars-ast.js';
import { chunkHandlebars, createHandlebarsChunker } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { collectHandlebarsImports, createHandlebarsImportCollector } from '../../../src/index/language-registry/import-collectors/handlebars.js';
import { createHandlebarsManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const text = [
  'Emoji 🚀',
  '{{{{raw}}}}',
  '{{#fake}} {{> fakePartial}} {{#*inline "fakeLocal"}} {{/inline}} {{/fake}}',
  '{{{{/raw}}}}',
  '\\{{> escapedPartial}}',
  '{{!-- {{#commentFake}} {{> commentPartial}} --}}',
  '{{> realPartial}}',
  '{{#> layout}}Real layout content{{/layout}}',
  '{{#*inline "realLocal"}}Local content{{/inline}}',
  '{{#if ok}}{{> realLocal}}{{else}}{{> fallback}}{{/if}}',
  '{{> (lookup . "selectedPartial")}}',
  ''
].join('\r\n');
const structure = parseHandlebarsStructure(text);
assert.equal(structure.parser, 'handlebars-parser');
assert.equal(structure.coverage, 'syntax-only');
assert.equal(parseHandlebarsStructure(text), structure, 'one immutable bounded syntax model is shared');
assert.ok(Object.isFrozen(structure.partials) && Object.isFrozen(structure.partials[0]));
assert.deepEqual(structure.blocks.map((block) => block.name), ['raw', 'layout', 'inline realLocal', 'if']);
assert.deepEqual(structure.definitions.map((definition) => definition.name), ['realLocal']);
assert.deepEqual(structure.imports, ['realPartial', 'layout', 'fallback']);
assert.equal(structure.partials.filter((partial) => partial.kind === 'dynamic').length, 1);
assert.equal(structure.partials.find((partial) => partial.name === 'realLocal').kind, 'inline');
const chunks = chunkHandlebars(text);
assert.deepEqual(chunks.map((chunk) => chunk.name), ['raw', 'layout', 'inline realLocal', 'if']);
assert.ok(chunks.every((chunk) => chunk.meta.parserCoverage === 'syntax-only'
  && chunk.start <= chunk.meta.astRange.start && chunk.end >= chunk.meta.astRange.end));
assert.equal(text.slice(chunks[1].meta.astRange.start, chunks[1].meta.astRange.end), '{{#> layout}}Real layout content{{/layout}}');
assert.equal(chunks.at(-1).meta.unresolvedDynamicPartials, 1);
assert.deepEqual(collectHandlebarsImports(text), ['realPartial', 'layout', 'fallback']);
const adapter = createHandlebarsManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.exports, ['realLocal']);
assert.deepEqual(relations.imports, ['fallback', 'layout', 'realPartial']);
assert.ok(relations.usages.includes('lookup') && relations.usages.includes('realLocal'));
assert.ok(!relations.usages.includes('fakePartial') && !relations.usages.includes('escapedPartial'));
assert.ok(!relations.calls.some((edge) => edge.includes('fakeLocal')));
assert.ok(!relations.usages.includes('.'));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.equal(adapter.extractDocMeta({ chunk: chunks[0] }).source, 'managed-handlebars-syntax');

const unicode = '🚀 {{#if ok}}{{> "quoted/name"}}{{/if}}';
assert.equal(chunkHandlebars(unicode)[0].meta.astRange.start, 3);
assert.deepEqual(collectHandlebarsImports(unicode), ['quoted/name']);
for (const newline of ['\n', '\r\n', '\r']) {
  const source = `🚀${newline}{{#if ok}}x{{/if}}`;
  const range = chunkHandlebars(source)[0].meta.astRange;
  assert.equal(source.slice(range.start, range.end), '{{#if ok}}x{{/if}}');
}
const nesting = '{{#if ok}}{{#each rows}}{{value}}{{/each}}{{else}}Empty{{/if}}';
assert.equal(chunkHandlebars(nesting).length, 1, 'outermost block chunks do not overlap nested blocks');
assert.ok(adapter.buildRelations({ text: nesting, options: {} }).usages.includes('value'));
const scopes = '{{#if ok}}{{#*inline "local"}}L{{/inline}}{{> local}}{{/if}}\n{{> local}}';
assert.deepEqual(parseHandlebarsStructure(scopes).partials.map((partial) => partial.kind), ['inline', 'static']);
assert.deepEqual(collectHandlebarsImports(scopes), ['local']);
const internal = '{{#> layout}}{{> @partial-block}}{{/layout}}';
assert.deepEqual(collectHandlebarsImports(internal), ['layout']);
assert.ok(!adapter.buildRelations({ text: internal, options: {} }).usages.includes('@partial-block'));
const sameLine = '{{#if a}}A{{/if}}{{#if b}}B{{/if}}';
const sameLineChunks = chunkHandlebars(sameLine);
assert.equal(sameLineChunks.length, 2);
assert.ok(sameLineChunks[0].end === sameLineChunks[1].start && sameLineChunks.every((chunk) => chunk.end > chunk.start));
assert.equal(parseHandlebarsStructure('').parser, 'handlebars-parser');

const malformed = '{{#if ok}}';
assert.equal(chunkHandlebars(malformed)[0].meta.parserCoverage, 'heuristic');
assert.equal(chunkHandlebars(malformed)[0].meta.parserFallbackReason, 'parse-failed');
let loads = 0;
const missing = createHandlebarsStructureParser({ loadParser: () => { loads += 1; throw new Error('Controlled missing parser'); } });
const fallback = createHandlebarsChunker({ parseStructure: missing })('{{#if ok}}X{{/if}}');
assert.equal(fallback[0].meta.astRange, undefined);
assert.equal(fallback[0].meta.parserFallbackReason, 'parser-unavailable');
const fallbackImports = createHandlebarsImportCollector({ parseStructure: missing });
assert.deepEqual(fallbackImports('{{> old}}'), ['old']);
assert.deepEqual(fallbackImports('{{> first}}\n{{> second}}', {
  collectorScanBudget: { maxLines: 1, maxMs: 0 }
}), ['first']);
assert.deepEqual(createHandlebarsManagedAdapter({ parseStructure: missing }).buildRelations({
  text: '{{#*inline "old"}}X{{/inline}}', options: {}
}).exports, ['old']);
assert.equal(loads, 1);
const unsupported = createHandlebarsStructureParser({ loadParser: () => {
  const error = new Error('Controlled async-only module');
  error.code = 'ERR_REQUIRE_ASYNC_MODULE';
  throw error;
} });
assert.equal(unsupported('text').reason, 'parser-unsupported');
assert.equal(createHandlebarsStructureParser({ loadParser: () => ({}) })('text').reason, 'parser-unsupported');
assert.equal(createHandlebarsStructureParser({ loadParser: () => ({ parseWithoutProcessing: () => ({ type: 'Unknown' }) }) })('x').reason, 'unsupported-ast');
assert.equal(parseHandlebarsStructure('x'.repeat(524289)).reason, 'source-limit');
assert.equal(parseHandlebarsStructure('\r'.repeat(3001)).reason, 'line-limit');
assert.equal(parseHandlebarsStructure('{{1}}'.repeat(11000)).reason, 'node-limit');
assert.equal(parseHandlebarsStructure('{{value}}'.repeat(4097)).reason, 'entry-limit');
assert.equal(parseHandlebarsStructure('{{#if x}}'.repeat(70) + 'X' + '{{/if}}'.repeat(70)).reason, 'depth-limit');
assert.equal(parseHandlebarsStructure('{{> ' + 'x'.repeat(4097) + '}}').reason, 'name-limit');
const limited = { collectorScanBudget: { maxMatches: 1, maxTokens: 8, maxMs: 0 } };
assert.deepEqual(collectHandlebarsImports(text, limited), ['realPartial']);
assert.deepEqual(adapter.buildRelations({ text, options: limited }).exports, ['realLocal']);
const firstLine = { collectorScanBudget: { maxLines: 1, maxMs: 0 } };
assert.deepEqual(collectHandlebarsImports(text, firstLine), []);
assert.deepEqual(adapter.buildRelations({ text, options: firstLine }).exports, []);
const invalid = createHandlebarsStructureParser({ loadParser: () => ({ parseWithoutProcessing: () => ({
  type: 'Program', body: [{ type: 'PartialStatement', name: { type: 'StringLiteral', value: 'invalid' },
    loc: { start: { line: 0, column: 0 }, end: { line: 1, column: 1 } } }]
}) }) });
assert.equal(invalid('text').reason, 'invalid-source-range');
console.log('Handlebars syntax owners exclude raw/escaped/comment phantoms with bounded UTF-16 ranges and unresolved dynamic partials');
