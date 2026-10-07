import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTomlStructureParser, parseTomlStructure } from '../../../src/shared/toml-structure.js';
import { createTomlImportCollector, collectTomlImports } from '../../../src/index/language-registry/import-collectors/toml.js';
import { chunkIniToml, createTomlChunker } from '../../../src/index/chunking/formats/ini-toml.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { collectLanguageImports } from '../../../src/index/language-registry/registry.js';
import { buildConfigFileAdapters } from '../../../src/index/language-registry/adapters/config-files.js';

const vendor = createRequire(import.meta.url)('smol-toml');
const forbidden = () => { throw Error('Excluded file/reference loading or serialization'); };
globalThis.fetch = forbidden;
const text = ['description = """', '😀 documentation only', '[dependencies]',
  'fake = { path = "./fake" }', 'include = ["string.fake"]', '"""', '[tool.poc]',
  'include = [', ' "real.toml",', ' "comma,name.toml",', ']', '[dependencies]',
  'actual = { path = "../real" }', 'registry_only = "1.0"'].join('\r\n');
const model = parseTomlStructure(text);
assert.equal(model.parser, 'smol-toml-values+lexical');
assert.equal(model.coverage, 'partial');
assert.equal(model.rangeSource, 'application-utf16-lexer');
assert.equal(parseTomlStructure(text), model);
assert.ok(Object.isFrozen(model) && Object.isFrozen(model.importEntries[0].keyRange));
assert.deepEqual(model.headings.map((entry) => entry.name), ['tool.poc', 'dependencies']);
assert.deepEqual(model.importEntries.map((entry) => entry.value), ['real.toml', 'comma,name.toml', '../real']);
assert.equal(model.headings[0].start, text.indexOf('[tool.poc]'));
assert.equal(model.headings[1].start, text.lastIndexOf('[dependencies]'));
assert.equal(text.slice(model.headings[0].start, model.headings[0].end), '[tool.poc]');
assert.equal(text.slice(model.importEntries[0].keyRange.start, model.importEntries[0].keyRange.end), 'include');
assert.equal(text.slice(model.importEntries[0].start, model.importEntries[0].end), 'include = [\r\n "real.toml",\r\n "comma,name.toml",\r\n]');
assert.deepEqual(collectTomlImports(text), ['real.toml', 'comma,name.toml', '../real']);
assert.deepEqual(collectLanguageImports({ text, ext: '.toml', relPath: 'Cargo.toml', mode: 'code' }), collectTomlImports(text).sort());
const chunks = smartChunk({ text, ext: '.toml', relPath: 'Cargo.toml', mode: 'code' });
assert.deepEqual(chunks.map((entry) => entry.name), ['tool.poc', 'dependencies']);
assert.ok(chunks.every((entry) => entry.meta.parser === model.parser && entry.meta.parserCoverage === 'partial'
  && entry.meta.astRange === undefined && entry.meta.rangeSource === 'application-utf16-lexer'));
assert.equal(chunks[0].start, text.lastIndexOf('\n', model.headings[0].start) + 1);
assert.equal(chunks[0].end, chunks[1].start);
const tomlAdapter = buildConfigFileAdapters().find((adapter) => adapter.id === 'toml');
assert.deepEqual(tomlAdapter.buildRelations({ text, options: {} }).imports, collectTomlImports(text).sort());

const quoted = ['"in\\u0063lude" = "escaped.toml"', '"literal.dot".includes = ["dotted.toml"]',
  '"" = "empty key"', 'count = 9223372036854775807', 'date = 1979-05-27T07:32:00Z',
  '["tool.poc"."😀"]', "'include' = 'unicode.toml'", '[dependencies."quoted.crate"]',
  'path = "../quoted"', 'version = "1.0"'].join('\n');
const quotedModel = parseTomlStructure(quoted);
assert.equal(quotedModel.reason, null);
assert.deepEqual(quotedModel.importEntries.map((entry) => entry.value), ['escaped.toml', 'dotted.toml', 'unicode.toml', '../quoted']);
assert.equal(quoted.slice(quotedModel.importEntries[0].keyRange.start, quotedModel.importEntries[0].keyRange.end), '"in\\u0063lude"');
assert.deepEqual(quotedModel.headings[0].path, ['tool.poc', '😀']);
assert.deepEqual(quotedModel.headings[1].path, ['dependencies', 'quoted.crate']);
assert.equal(quoted.slice(quotedModel.headings[0].start, quotedModel.headings[0].end), '["tool.poc"."😀"]');
assert.deepEqual(collectTomlImports(quoted), ['escaped.toml', 'dotted.toml', 'unicode.toml', '../quoted']);

const arrays = ['[[plugins]]', 'include = "first.toml"', '[plugins.settings]', 'source = "first.source"',
  '[[plugins.children]]', 'include = "first-child.toml"', '[[plugins.children]]', 'include = "second-child.toml"',
  '[[plugins]]', 'include = "second.toml"', '[plugins.settings]', 'source = "second.source"',
  '[[plugins.children]]', 'include = "third-child.toml"'].join('\n');
const arrayModel = parseTomlStructure(arrays);
assert.equal(arrayModel.reason, null);
assert.deepEqual(arrayModel.headings.map((entry) => entry.path), [['plugins', 0], ['plugins', 0, 'settings'],
  ['plugins', 0, 'children', 0], ['plugins', 0, 'children', 1], ['plugins', 1],
  ['plugins', 1, 'settings'], ['plugins', 1, 'children', 0]]);
assert.deepEqual(collectTomlImports(arrays), ['first.toml', 'first.source', 'first-child.toml', 'second-child.toml',
  'second.toml', 'second.source', 'third-child.toml']);

const multiline = ['description = """', 'escaped quote \\" then [fake]', 'include = "fake"', '"""',
  "literal = '''", '[also.fake]', 'include = "fake2"', "'''", 'include = """real.toml"""',
  'imports = ["#inside.toml", "comma,name.toml"] # include = "comment.fake"',
  "extends = '''literal.toml'''", 'source = """join\\', '  ed.toml"""'].join('\n');
assert.equal(parseTomlStructure(multiline).reason, null);
assert.deepEqual(parseTomlStructure(multiline).headings, []);
assert.deepEqual(parseTomlStructure(multiline).importEntries.map((entry) => entry.value),
  ['real.toml', '#inside.toml', 'comma,name.toml', 'literal.toml', 'joined.toml']);
for (const quotes of [4, 5]) {
  const source = 'description = """body' + '"'.repeat(quotes) + '\ninclude = "real.toml"';
  assert.equal(parseTomlStructure(source).reason, null, 'valid closing quote runs remain opaque');
  assert.deepEqual(collectTomlImports(source), ['real.toml']);
}
assert.deepEqual(collectTomlImports('__proto__.include = "own.toml"\nconstructor.include = "ctor.toml"'), ['own.toml', 'ctor.toml']);
assert.equal({}.include, undefined);
for (const source of ['include="old"\ninclude="new"', '[x]\na=1\n[x]\na=2',
  'include=["real"', 'description="""\n[phantom]', '[table', 'include="unterminated', 'include = nope']) {
  assert.ok(parseTomlStructure(source).reason);
  assert.deepEqual(collectTomlImports(source), [], 'malformed or duplicate keys do not produce partial phantom facts');
  assert.equal(chunkIniToml(source, 'toml', {})[0].meta.parserCoverage, 'unavailable');
}
assert.equal(parseTomlStructure('').reason, null);
const ini = '[server]\nport=8080\n[server]\nport=8081';
assert.deepEqual(chunkIniToml(ini, 'ini', {}).map((entry) => entry.name), ['server', 'server']);
assert.ok(chunkIniToml(ini, 'ini', {}).every((entry) => entry.meta.parser === undefined), 'INI ownership is unchanged');

let loads = 0;
const missing = createTomlStructureParser({ loadParser: () => { loads += 1; throw Error('Controlled missing parser'); } });
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(loads, 1);
assert.deepEqual(createTomlImportCollector({ parseStructure: missing })(text), []);
assert.equal(createTomlChunker({ parseStructure: missing })(text)[0].meta.parserFallbackReason, 'parser-unavailable');
assert.equal(createTomlStructureParser({ loadParser: () => ({}) })(text).reason, 'parser-unsupported');
const stable = createTomlStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(786433)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(3500)).reason, 'line-limit');
assert.equal(stable('include="' + 'x'.repeat(32769) + '"').reason, 'token-length-limit');
assert.equal(stable('values=[' + '0,'.repeat(32769) + '0]').reason, 'token-limit');
assert.equal(stable('values=[' + '0,'.repeat(20000) + '0]').reason, 'node-limit');
let depthVendorCalls = 0;
const bounded = createTomlStructureParser({ now: () => 0, loadParser: () => ({ parse: (...args) => {
  depthVendorCalls += 1; return vendor.parse(...args);
} }) });
assert.equal(bounded('values=' + '['.repeat(65) + '0' + ']'.repeat(65)).reason, 'depth-limit');
assert.equal(bounded(Array.from({ length: 65 }, () => 'key').join('.') + '=1').reason, 'path-depth-limit');
assert.equal(depthVendorCalls, 0, 'deep lexical containers and paths are rejected before synchronous parsing');
const cycle = {}; cycle.self = cycle;
assert.equal(createTomlStructureParser({ now: () => 0, loadParser: () => ({ parse: () => cycle }) })('').reason, 'cyclic-value');
const deepValues = {};
let nested = deepValues;
for (let index = 0; index < 65; index += 1) nested = (nested.child = {});
assert.equal(createTomlStructureParser({ now: () => 0, loadParser: () => ({ parse: () => deepValues }) })('').reason, 'semantic-depth-limit');
assert.equal(createTomlStructureParser({ loadParser: () => ({ parse: () => [] }) })('').reason, 'unsupported-document');
const expired = createTomlStructureParser();
assert.equal(expired('include="real"', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(expired('include="real"', { remainingMs: () => NaN }).reason, 'time-limit');
assert.equal(expired('include="real"').reason, null);
assert.equal(expired('include="real"', { remainingMs: () => 0 }).reason, 'time-limit', 'cache hits still check the actual caller deadline');
for (const mode of ['chunk', 'import']) {
  let clock = 0;
  const parseStructure = createTomlStructureParser({ now: () => clock, loadParser: () => ({ parse: (...args) => {
    clock += 11; return vendor.parse(...args);
  }, stringify: forbidden }) });
  const source = 'include="real"';
  if (mode === 'chunk') assert.equal(createTomlChunker({ parseStructure })(source,
    { treeSitter: { byLanguage: { toml: { maxParseMs: 10 } } } })[0].meta.parserFallbackReason, 'time-limit');
  else assert.deepEqual(createTomlImportCollector({ parseStructure })(source,
    { collectorNow: () => clock, collectorScanBudget: { maxMs: 10 } }), []);
  clock = 0;
  assert.equal(parseStructure(source, { maxMs: 10 }).metrics.measuredOverrunMs, 1);
}
assert.deepEqual(collectTomlImports('include=["first","second"]', { collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectTomlImports('include=["first","second"]', { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectTomlImports('include=[\n"excluded"\n]\nsource="later"',
  { collectorScanBudget: { maxLines: 2, maxMs: 0 } }), [], 'partial multiline assignments are omitted');
assert.deepEqual(collectTomlImports('include="first"\nsource="excluded"',
  { collectorScanBudget: { maxLines: 1, maxMs: 0 } }), ['first']);
let clock = 0;
const cold = createTomlStructureParser({ now: () => clock, initializationNow: () => clock,
  loadParser: () => { clock += 60; return vendor; } });
assert.deepEqual(createTomlImportCollector({ parseStructure: cold })('include="real"',
  { collectorNow: () => clock, collectorScanBudget: { maxMs: 30 } }), ['real']);
assert.equal(cold.initialize().elapsedMs, 60);
console.log('TOML semantic values and application-owned UTF-16 ranges share bounded string/comment-aware ownership; INI remains unchanged');
