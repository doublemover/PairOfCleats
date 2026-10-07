import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createJsoncStructureParser, parseJsoncStructure } from '../../../src/shared/jsonc-structure.js';
import { collectJsonImports, createJsoncImportCollector } from '../../../src/index/language-registry/import-collectors/json.js';
import { chunkJson, createJsoncChunker } from '../../../src/index/chunking/formats/json.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { collectLanguageImports, getLanguageForFile } from '../../../src/index/language-registry/registry.js';
import { createJsonConfigAdapter } from '../../../src/index/language-registry/adapters/config-files.js';

const vendor = createRequire(import.meta.url)('jsonc-parser');
const forbidden = () => { throw Error('Excluded object evaluation, modification or reference loading'); };
for (const key of ['parse', 'getNodeValue', 'format', 'modify', 'applyEdits']) vendor[key] = forbidden;
globalThis.fetch = forbidden;
const text = ['{', ' // 😀 "$ref": "comment.fake"', ' "extends": "old.json",',
  ' "extends": "real.json",', ' "nested": {"$ref": "old.schema", "$r\\u0065f": "schema.json",},',
  ' "description": "\\"imports\\": \\"string.fake\\"",', ' "a\\u0020key": true,', '}'].join('\r\n');
const model = parseJsoncStructure(text);
assert.equal(model.parser, 'jsonc-parser');
assert.equal(model.coverage, 'partial');
assert.equal(model.rangeSource, 'vendor-utf16-node');
assert.equal(parseJsoncStructure(text), model);
assert.ok(Object.isFrozen(model) && Object.isFrozen(model.properties[0].keyRange));
assert.deepEqual(model.properties.map((entry) => entry.name), ['extends', 'nested', 'description', 'a key']);
assert.equal(model.properties[0].start, text.lastIndexOf('"extends"'), 'effective property range points to the last duplicate');
assert.equal(text.slice(model.properties[0].keyRange.start, model.properties[0].keyRange.end), '"extends"');
assert.deepEqual(model.importEntries.map((entry) => entry.value), ['real.json', 'schema.json']);
assert.equal(text.slice(model.importEntries[1].keyRange.start, model.importEntries[1].keyRange.end), '"$r\\u0065f"');
assert.ok(model.importEntries.every((entry) => entry.start >= entry.propertyRange.start && entry.end <= entry.propertyRange.end));
assert.deepEqual(collectLanguageImports({ text, ext: '.jsonc', relPath: 'config/settings.jsonc', mode: 'code' }), ['real.json', 'schema.json']);
const chunks = smartChunk({ text, ext: '.jsonc', relPath: 'config/settings.jsonc', mode: 'code' });
assert.deepEqual(chunks.map((entry) => entry.name), ['extends', 'nested', 'description', 'a key']);
assert.ok(chunks.every((entry) => entry.meta.jsonDialect === 'jsonc' && entry.meta.parser === 'jsonc-parser'
  && entry.meta.effectiveProperty === true && entry.start === entry.meta.keyRange.start));
assert.equal(chunks[0].start, text.lastIndexOf('"extends"'));
const adapter = createJsonConfigAdapter();
assert.deepEqual(adapter.buildRelations({ text, ext: '.jsonc', relPath: 'config/settings.jsonc', options: {} }).imports, ['real.json', 'schema.json']);
assert.deepEqual(collectJsonImports(text), [], 'anonymous input remains strict JSON');
for (const ext of ['.json', '.resolved']) {
  assert.equal(getLanguageForFile(ext, `config/settings${ext}`).id, 'json');
  assert.deepEqual(collectJsonImports(text, { ext }), []);
  assert.deepEqual(adapter.buildRelations({ text, ext, options: {} }).imports, []);
  assert.equal(chunkJson(text, { ext }), null, 'strict formats do not inherit JSONC comments/trailing commas');
  assert.ok(smartChunk({ text: '{"include":"real"}', ext, mode: 'code' }).some((entry) => entry.name === 'include'));
}
assert.deepEqual(collectJsonImports(text, { relPath: 'config\\settings.JSONC' }), ['real.json', 'schema.json']);
const duplicate = '{"include":"old","include":"new","nested":{"$ref":"old2","$ref":"new2"}}';
assert.deepEqual(collectJsonImports(duplicate), ['new', 'new2']);
assert.deepEqual(collectJsonImports(duplicate, { ext: '.jsonc' }), ['new', 'new2']);
const shadowedAncestor = '{"nested":{"$ref":"shadowed"},"nested":{"$ref":"actual"}}';
assert.deepEqual(collectJsonImports(shadowedAncestor, { ext: '.jsonc' }), collectJsonImports(shadowedAncestor));
assert.deepEqual(collectJsonImports(shadowedAncestor, { ext: '.jsonc' }), ['actual']);
assert.equal(parseJsoncStructure(shadowedAncestor).properties[0].start, shadowedAncestor.lastIndexOf('"nested"'));
const referenceDepth = '{"include":{"one":{"two":{"three":"ok","four":{"five":"excluded"}}}}}';
assert.deepEqual(collectJsonImports(referenceDepth, { ext: '.jsonc' }), collectJsonImports(referenceDepth));
assert.deepEqual(collectJsonImports(referenceDepth), ['ok']);
assert.deepEqual(collectJsonImports('{"__proto__":{"include":"own.json"},"constructor":{"include":"ctor.json"}}', { ext: '.jsonc' }), ['own.json', 'ctor.json']);
assert.equal({}.polluted, undefined);
assert.equal(parseJsoncStructure('true').rootType, 'boolean');
assert.equal(chunkJson('[1,2,]', { ext: '.jsonc' })[0].name, 'root');
for (const source of ['{"$ref":"real","broken":}', '{"extends":"real"', '/* unclosed', '{"unclosed":"value}', '{"key":NaN}', "{'key':'value'}"]) {
  assert.ok(parseJsoncStructure(source).reason);
  assert.deepEqual(collectJsonImports(source, { ext: '.jsonc' }), []);
  assert.equal(chunkJson(source, { ext: '.jsonc' })[0].meta.parserCoverage, 'unavailable');
}
let loads = 0;
const missing = createJsoncStructureParser({ loadParser: () => { loads += 1; throw Error('Controlled missing parser'); } });
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(loads, 1);
assert.deepEqual(createJsoncImportCollector({ parseStructure: missing })(text), []);
assert.equal(createJsoncChunker({ parseStructure: missing })(text)[0].meta.parserFallbackReason, 'parser-unavailable');
assert.equal(createJsoncStructureParser({ loadParser: () => ({}) })(text).reason, 'parser-unsupported');
const stable = createJsoncStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(262145)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(4000)).reason, 'line-limit');
assert.equal(stable('["' + 'x'.repeat(32769) + '"]').reason, 'token-length-limit');
assert.equal(stable('[' + '0,'.repeat(32769) + '0]').reason, 'token-limit');
assert.equal(stable('{' + Array.from({ length: 6700 }, (_, index) => `"k${index}":0`).join(',') + '}').reason, 'node-limit');
let depthVendorCalls = 0;
const boundedDepth = createJsoncStructureParser({ now: () => 0, loadParser: () => ({ ...vendor, parseTree: (...args) => {
  depthVendorCalls += 1; return vendor.parseTree(...args);
} }) });
assert.equal(boundedDepth('['.repeat(65) + '0' + ']'.repeat(65)).reason, 'depth-limit');
assert.equal(depthVendorCalls, 0, 'deep JSONC does not enter the recursive vendor parser');
assert.equal(chunkJson('{"payload":' + '['.repeat(15000) + '0' + ']'.repeat(15000) + '}', {}).at(0).name, 'payload', 'legacy strict/deep path remains iterative');
const deepReference = '{"payload":' + '['.repeat(80) + '{"$ref":"deep.schema"}' + ']'.repeat(80) + '}';
assert.deepEqual(collectJsonImports(deepReference, { ext: '.jsonc' }), collectJsonImports(deepReference), 'valid strict data retains prior deep JSONC reference behavior');
assert.deepEqual(collectJsonImports(deepReference, { ext: '.jsonc' }), ['deep.schema']);
const compatibleDeepChunk = chunkJson(deepReference, { ext: '.jsonc' })[0];
assert.equal(compatibleDeepChunk.name, 'payload');
assert.equal(compatibleDeepChunk.meta.parser, 'legacy-strict-json');
assert.equal(compatibleDeepChunk.meta.parserCoverage, 'heuristic');
assert.equal(compatibleDeepChunk.meta.astRange, undefined, 'strict compatibility has no invented vendor range');
assert.ok(compatibleDeepChunk.meta.parseMetrics.elapsedMs >= compatibleDeepChunk.meta.parseMetrics.compatibilityElapsedMs);
assert.deepEqual(collectJsonImports(deepReference.replace('{"payload":', '{/* comment */"payload":'), { ext: '.jsonc' }), []);
assert.equal(chunkJson(deepReference.replace('{"payload":', '{/* comment */"payload":'), { ext: '.jsonc' })[0].meta.parser, 'jsonc-unavailable');
const partialDeep = '{\n"payload":' + '['.repeat(80) + '\n{"$ref":"excluded"}' + ']'.repeat(80) + '\n}';
assert.deepEqual(collectJsonImports(partialDeep, { ext: '.jsonc', collectorScanBudget: { maxLines: 2, maxMs: 0 } }), [], 'positionless compatibility references are omitted for a partial line window');
const nativeParse = JSON.parse;
let compatibilityClock = 0;
const compatibilityDiagnostics = [];
try {
  JSON.parse = (...args) => { compatibilityClock += 31; return nativeParse(...args); };
  assert.deepEqual(collectJsonImports(deepReference, { ext: '.jsonc', collectorNow: () => compatibilityClock,
    collectorScanBudget: { maxMs: 30 }, collectorDiagnostics: compatibilityDiagnostics }), []);
} finally { JSON.parse = nativeParse; }
assert.ok(compatibilityDiagnostics.some((entry) => entry.reasons.includes('scan_time')), 'native compatibility parse remains inside the actual caller deadline');
const fake = (root) => createJsoncStructureParser({ now: () => 0, loadParser: () => ({ ...vendor, parseTree: () => root }) });
assert.equal(fake({ type: 'object', offset: -1, length: 2, children: [] })('{}').reason, 'invalid-tree-range');
assert.equal(fake({ type: 'unknown', offset: 0, length: 2 })('{}').reason, 'unsupported-tree');
assert.equal(fake({ type: 'object', offset: 0, length: 2, children: [{ type: 'string', offset: 0, length: 1, value: 'x' }] })('{}').reason, 'unsupported-object');
const invalidProperty = { type: 'property', offset: 1, length: 5,
  children: [{ type: 'string', offset: 0, length: 3, value: 'a' }, { type: 'number', offset: 5, length: 1, value: 1 }] };
assert.equal(fake({ type: 'object', offset: 0, length: 7, children: [invalidProperty] })('{"a":1}').reason, 'invalid-child-range');
const expired = createJsoncStructureParser();
assert.equal(expired('{}', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(expired('{}', { remainingMs: () => NaN }).reason, 'time-limit');
assert.equal(expired('{}').reason, null);
assert.equal(expired('{}', { remainingMs: () => 0 }).reason, 'time-limit', 'cached model does not bypass admission');
for (const mode of ['chunk', 'import']) {
  let clock = 0;
  const parseStructure = createJsoncStructureParser({ now: () => clock, loadParser: () => ({ ...vendor, parseTree: (...args) => {
    clock += 11; return vendor.parseTree(...args);
  } }) });
  const source = '{"include":"real"}';
  if (mode === 'chunk') assert.equal(createJsoncChunker({ parseStructure })(source,
    { treeSitter: { byLanguage: { json: { maxParseMs: 10 } } } })[0].meta.parserFallbackReason, 'time-limit');
  else assert.deepEqual(createJsoncImportCollector({ parseStructure })(source, { collectorNow: () => clock, collectorScanBudget: { maxMs: 10 } }), []);
  clock = 0;
  const result = parseStructure(source, { maxMs: 10 });
  assert.equal(result.metrics.measuredOverrunMs, 1);
}
const source = '{\n"include":"first",\n"nested":{"$ref":"excluded"}\n}';
assert.deepEqual(collectJsonImports(source, { ext: '.jsonc', collectorScanBudget: { maxLines: 2, maxMs: 0 } }), ['first']);
assert.deepEqual(collectJsonImports('{"includes":["first","second"]}', { ext: '.jsonc', collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectJsonImports('{"includes":["first","second"]}', { ext: '.jsonc', collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['first']);
let clock = 0;
assert.deepEqual(adapter.buildRelations({ text: source, ext: '.jsonc', options: { collectorNow: () => (clock += 10), collectorScanBudget: { maxMs: 10 } } }).imports, []);
clock = 0;
const cold = createJsoncStructureParser({ now: () => clock, initializationNow: () => clock, loadParser: () => { clock += 60; return vendor; } });
assert.deepEqual(createJsoncImportCollector({ parseStructure: cold })('{"include":"real"}', { collectorNow: () => clock, collectorScanBudget: { maxMs: 30 } }), ['real']);
assert.equal(cold.initialize().elapsedMs, 60);
console.log('Explicit JSONC syntax ownership preserves effective UTF-16 properties and strict/deep JSON contracts under caller bounds');
