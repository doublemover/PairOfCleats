import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMustacheStructureParser, parseMustacheStructure } from '../../../src/shared/mustache-structure.js';
import { chunkMustache, createMustacheChunker } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { collectMustacheImports, createMustacheImportCollector } from '../../../src/index/language-registry/import-collectors/mustache.js';
import { createMustacheManagedAdapter } from '../../../src/index/language-registry/adapters/heuristic.js';

const vendor = createRequire(import.meta.url)('mustache');
const forbidden = () => { throw new Error('Excluded template rendering/view lookup/partial loading'); };
vendor.render = forbidden;
vendor.Context.prototype.lookup = forbidden;
for (const key of ['render', 'renderTokens', 'renderSection', 'renderPartial', 'renderInverted', 'renderName']) {
  vendor.Writer.prototype[key] = forbidden;
}
const text = [
  '😀 header',
  '{{! =<% %>=}}', // A delimiter-looking comment does not change delimiters.
  '{{#before}} {{> before.partial}} {{/before}}',
  '{{=<% %>=}}',
  '{{#phantom}} {{> fake.partial}} {{/phantom}}',
  '<%! {{#CommentGhost}} {{> comment.fake}} %>',
  '<%#real%>',
  '<%> actual.partial %>',
  '<%user.name%>',
  '<%^nested%><%&raw.value%><%/nested%>',
  '<%/real%>',
  '<%={{ }}=%>',
  '{{^empty}} {{> restored.partial}} {{/empty}}',
  '{{{unescaped}}}'
].join('\r\n');
const structure = parseMustacheStructure(text);
assert.equal(structure.parser, 'mustache-parse-tokens');
assert.equal(structure.coverage, 'partial');
assert.equal(structure.rangeSource, 'vendor-utf16-token');
assert.equal(parseMustacheStructure(text), structure);
assert.ok(Object.isFrozen(structure) && Object.isFrozen(structure.sections[0]));
assert.deepEqual(structure.sections.map((entry) => entry.name), ['before', 'real', 'nested', 'empty']);
assert.deepEqual(structure.partials.map((entry) => entry.name), ['before.partial', 'actual.partial', 'restored.partial']);
assert.ok(!structure.referenceEntries.some((entry) => /phantom|fake|Ghost/u.test(entry.value)));
const real = structure.sections[1];
assert.equal(real.start, text.indexOf('<%#real%>'));
assert.equal(text.slice(real.start, real.end), '<%#real%>');
assert.equal(real.closeStart, text.indexOf('<%/real%>'));
assert.equal(structure.sections[0].start, text.indexOf('{{#before}}'), 'emoji occupies two UTF-16 code units');
const chunks = chunkMustache(text);
assert.deepEqual(chunks.map((entry) => entry.name), ['before', 'real', 'empty']);
assert.ok(chunks.every((entry, index) => entry.meta.astRange === undefined
  && entry.meta.rangeSource === 'vendor-utf16-token' && entry.start === entry.meta.tokenRange.start
  && (index === 0 || entry.start === chunks[index - 1].end)));
assert.equal(chunks[1].meta.sectionCloseStart, real.closeStart);
assert.deepEqual(collectMustacheImports(text), ['before.partial', 'actual.partial', 'restored.partial']);
const adapter = createMustacheManagedAdapter();
const relations = adapter.buildRelations({ text, options: {} });
assert.deepEqual(relations.exports, ['before', 'empty', 'nested', 'real']);
assert.ok(relations.usages.includes('user.name') && relations.usages.includes('raw.value') && relations.usages.includes('unescaped'));
assert.ok(!relations.usages.some((value) => /phantom|fake|Ghost/u.test(value)));
assert.deepEqual(relations.imports, collectMustacheImports(text));
assert.equal(adapter.capabilityProfile.state, 'partial');
assert.equal(adapter.extractDocMeta({ chunk: chunks[1] }).source, 'managed-mustache-syntax');
assert.ok(relations.calls.length <= 96);
assert.equal(parseMustacheStructure('').reason, null);
assert.deepEqual(chunkMustache('{{#one}}{{/one}}{{#two}}{{/two}}').map((entry) => entry.name), ['one', 'two']);
assert.equal(chunkMustache('😀 {{#one}}{{/one}}')[0].start, 3);
assert.deepEqual(collectMustacheImports('\\{{> real.partial}}'), ['real.partial'], 'Mustache has no Handlebars backslash tag escape');
assert.deepEqual(collectMustacheImports('{{> "literal.key"}} {{> name;)}}'), ['"literal.key"', 'name;)'], 'literal partial keys are not unquoted or rewritten');
assert.equal(parseMustacheStructure('{{format item}}').referenceEntries[0].value, 'format item', 'a Mustache lookup is not a helper call');

for (const source of ['{{#broken}}', '{{#one}}{{/two}}', '{{/missing}}', '{{name', '{{=<%>=}}']) {
  const result = parseMustacheStructure(source);
  assert.equal(result.reason, 'parse-failed');
  assert.equal(chunkMustache(source)[0].name, 'mustache');
  assert.deepEqual(collectMustacheImports(source), []);
  assert.deepEqual(adapter.buildRelations({ text: source, options: {} }).exports, []);
}
let loads = 0;
const missing = createMustacheStructureParser({ loadParser: () => { loads += 1; throw Error('Controlled missing dependency'); } });
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(loads, 1);
assert.deepEqual(createMustacheImportCollector({ parseStructure: missing })(text), []);
assert.equal(createMustacheChunker({ parseStructure: missing })(text)[0].meta.parserFallbackReason, 'parser-unavailable');
assert.deepEqual(createMustacheManagedAdapter({ parseStructure: missing }).buildRelations({ text, options: {} }).usages, []);
assert.equal(createMustacheStructureParser({ loadParser: () => ({}) })(text).reason, 'parser-unsupported');
let overLimitLoads = 0;
const bounded = createMustacheStructureParser({ loadParser: () => { overLimitLoads += 1; return {}; } });
assert.equal(bounded('x'.repeat(196609)).reason, 'source-limit');
assert.equal(overLimitLoads, 0, 'source admission precedes app initialization');

const stable = createMustacheStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(196609)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(3000)).reason, 'line-limit');
assert.equal(stable(`{{${'x'.repeat(4097)}}}`).reason, 'name-limit');
assert.equal(stable('{{#x}}'.repeat(129) + '{{/x}}'.repeat(129)).reason, 'depth-limit');
const fake = (parse) => createMustacheStructureParser({ now: () => 0, loadParser: () => ({ parse }) });
assert.equal(fake(() => Array.from({ length: 16385 }, () => ['!', '', 0, 0]))('').reason, 'token-limit');
assert.equal(fake(() => Array.from({ length: 4097 }, () => ['name', 'x', 0, 1]))('x').reason, 'node-limit');
assert.equal(fake(() => [['name', 'x', -1, 1]])('x').reason, 'invalid-token-range');
assert.equal(fake(() => [['#', 'x', 0, 1, [], 0]])('x').reason, 'invalid-section-range');
assert.equal(fake(() => [['unknown', 'x', 0, 1]])('x').reason, 'unsupported-tokens');
const repeated = ['name', 'x', 0, 1];
assert.equal(fake(() => [repeated, repeated])('x').reason, 'unsupported-tokens');
const lineOptions = { collectorScanBudget: { maxLines: 2, maxMs: 0 } };
const lineSource = '{{> first}}\n{{#one}}{{name}}{{/one}}\n{{> excluded}}';
assert.deepEqual(collectMustacheImports(lineSource, lineOptions), ['first']);
assert.ok(!adapter.buildRelations({ text: lineSource, options: lineOptions }).usages.includes('excluded'));
assert.deepEqual(collectMustacheImports('{{> first}}{{> second}}', { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectMustacheImports('{{> first}}{{> second}}', { collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['first']);

for (const mode of ['chunk', 'import', 'relation']) {
  let clock = 0;
  let parses = 0;
  const writer = new vendor.Writer();
  const parseStructure = createMustacheStructureParser({ now: () => clock, loadParser: () => ({ parse: (...args) => {
    parses += 1;
    clock += 11;
    writer.templateCache = undefined;
    return writer.parse(...args);
  } }) });
  const source = '{{#real}}{{> owned.partial}}{{/real}}';
  const options = { collectorNow: () => clock, collectorScanBudget: { maxMs: 10 }, collectorDiagnostics: [] };
  if (mode === 'chunk') assert.equal(createMustacheChunker({ parseStructure })(source,
    { treeSitter: { byLanguage: { mustache: { maxParseMs: 10 } } } })[0].name, 'mustache');
  if (mode === 'import') assert.deepEqual(createMustacheImportCollector({ parseStructure })(source, options), []);
  if (mode === 'relation') assert.deepEqual(createMustacheManagedAdapter({ parseStructure }).buildRelations({ text: source, options }).exports, []);
  assert.equal(parses, 1);
  clock = 0;
  const result = parseStructure(source, { maxMs: 10 });
  assert.equal(result.reason, 'time-limit');
  assert.equal(result.metrics.effectiveLimitMsAtEntry, 10);
  assert.equal(result.metrics.measuredOverrunMs, 1, 'measured synchronous overrun remains visible');
}
let vendorCalls = 0;
const expired = createMustacheStructureParser({ loadParser: () => ({ parse: () => { vendorCalls += 1; return []; } }) });
assert.equal(expired('source', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(expired('source', { remainingMs: () => NaN }).reason, 'time-limit');
assert.equal(vendorCalls, 0);
const cached = createMustacheStructureParser();
assert.equal(cached('{{name}}').reason, null);
assert.equal(cached('{{name}}', { remainingMs: () => 0 }).reason, 'time-limit', 'cached model does not bypass caller admission');
let extractionClock = 0;
let extracting = false;
let extractionParses = 0;
const extractionExpired = createMustacheStructureParser({ now: () => {
  if (extracting) extractionClock += 10;
  return extractionClock;
}, loadParser: () => ({ parse: () => {
  extracting = true;
  extractionParses += 1;
  return Array.from({ length: 4 }, () => ['name', 'x', 0, 1]);
} }) });
assert.equal(extractionExpired('x').reason, 'time-limit');
assert.equal(extractionParses, 1, 'token extraction stays inside the deadline after the vendor returns');
let sharedParses = 0;
const sharedWriter = new vendor.Writer();
const shared = createMustacheStructureParser({ loadParser: () => ({ parse: (...args) => {
  sharedParses += 1;
  sharedWriter.templateCache = undefined;
  return sharedWriter.parse(...args);
} }) });
createMustacheChunker({ parseStructure: shared })(text);
createMustacheImportCollector({ parseStructure: shared })(text);
createMustacheManagedAdapter({ parseStructure: shared }).buildRelations({ text, options: {} });
assert.equal(sharedParses, 1, 'chunks, imports and relations share one parsed representation');
for (const mode of ['imports', 'relations']) {
  let clock = 0;
  const writer = new vendor.Writer();
  let cachedReads = 0;
  writer.templateCache = { get: () => { cachedReads += 1; }, set: forbidden };
  const parseStructure = createMustacheStructureParser({ initializationNow: () => clock, now: () => clock,
    loadParser: () => { clock += 60; return writer; } });
  const options = { collectorNow: () => clock, collectorScanBudget: { maxMs: 30 } };
  const source = '{{#real}}{{> owned.partial}}{{/real}}';
  if (mode === 'imports') assert.deepEqual(createMustacheImportCollector({ parseStructure })(source, options), ['owned.partial']);
  else assert.deepEqual(createMustacheManagedAdapter({ parseStructure }).buildRelations({ text: source, options }).exports, ['real']);
  assert.equal(parseStructure.initialize().elapsedMs, 60, 'cold setup remains separately measured');
  assert.equal(writer.templateCache, undefined);
  assert.equal(cachedReads, 0, 'public writer cache is disabled');
}
console.log('Mustache parse-only tokens preserve delimiter semantics and UTF-16 ranges under caller/resource bounds');
