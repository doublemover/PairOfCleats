import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createYamlStructureParser, parseYamlStructure } from '../../../src/shared/yaml-structure.js';
import { createYamlImportCollector, collectYamlImports } from '../../../src/index/language-registry/import-collectors/yaml.js';
import { createYamlChunker, chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { collectLanguageImports } from '../../../src/index/language-registry/registry.js';
import { buildConfigFileAdapters } from '../../../src/index/language-registry/adapters/config-files.js';

const vendor = createRequire(import.meta.url)('yaml');
const forbidden = () => { throw Error('Excluded conversion, alias resolution, reference loading or rendering'); };
globalThis.fetch = forbidden;
vendor.Document.prototype.toJS = forbidden;
vendor.Document.prototype.toJSON = forbidden;
vendor.Alias.prototype.resolve = forbidden;
vendor.Alias.prototype.toJSON = forbidden;
const text = ['notes: |', '  😀 text only', '  include: "block.fake"', 'quoted: "first',
  '  include: quoted.fake', '  last"', 'include: ["real.yaml", "comma,name.yaml"]',
  '"im\\u0070ort": "escaped.yaml"'].join('\r\n');
const model = parseYamlStructure(text);
assert.equal(model.parser, 'yaml-syntax-nodes');
assert.equal(model.coverage, 'partial');
assert.equal(model.rangeSource, 'vendor-utf16-node');
assert.equal(parseYamlStructure(text), model);
assert.ok(Object.isFrozen(model) && Object.isFrozen(model.properties[0].keyRange));
assert.deepEqual(model.properties.map((entry) => entry.name), ['notes', 'quoted', 'include', 'import']);
assert.deepEqual(model.importEntries.map((entry) => entry.value), ['real.yaml', 'comma,name.yaml', 'escaped.yaml']);
assert.equal(text.slice(model.importEntries[1].start, model.importEntries[1].end), '"comma,name.yaml"');
assert.equal(text.slice(model.importEntries[2].keyRange.start, model.importEntries[2].keyRange.end), '"im\\u0070ort"');
assert.deepEqual(collectYamlImports(text), ['real.yaml', 'comma,name.yaml', 'escaped.yaml']);
assert.deepEqual(collectLanguageImports({ text, ext: '.yaml', relPath: 'config.yaml', mode: 'code' }), collectYamlImports(text).sort());
const topContext = { yamlChunking: { mode: 'top-level' } };
const chunks = chunkYaml(text, 'config.yaml', topContext);
assert.deepEqual(chunks.map((entry) => entry.name), ['notes', 'quoted', 'include', 'import']);
assert.ok(chunks.every((entry) => entry.meta.rangeSource === 'vendor-utf16-node'
  && entry.meta.sectionRangeSource === 'application-line-boundaries'
  && entry.meta.propertyRangeSource === 'application-key/value-span' && entry.meta.astRange === undefined));
assert.equal(chunks[2].meta.keyRange.start, text.indexOf('include: ["real'));
assert.equal(chunks[3].meta.keyRange.start, text.indexOf('"im\\u0070ort"'));
const adapter = buildConfigFileAdapters().find((entry) => entry.id === 'yaml');
assert.deepEqual(adapter.buildRelations({ text, options: {} }).imports, collectYamlImports(text).sort());

const workflow = ['notes: |', '  jobs:', '  fake:', '    runs-on: inert', 'jobs:',
  '  real:', '    runs-on: inert', 'env:', '  ALSO_NOT_A_JOB: inert'].join('\n');
const workflowChunks = chunkYaml(workflow, '.github/workflows/inert.yaml', {});
assert.deepEqual(workflowChunks.map((entry) => entry.name), ['real']);
assert.equal(workflowChunks[0].meta.format, 'github-actions');
assert.equal(workflowChunks[0].start, workflow.indexOf('  real:'));
assert.equal(workflow.slice(workflowChunks[0].meta.keyRange.start, workflowChunks[0].meta.keyRange.end), 'real');
assert.deepEqual(chunkYaml(workflow, 'ordinary.yaml', {}).map((entry) => entry.name), ['root'], 'default root policy is unchanged');
assert.equal(chunkYaml(text, 'ordinary.yaml', { yamlChunking: { mode: 'top-level', maxBytes: 1 } })[0].name, 'root');
assert.equal(chunkYaml(text, 'ordinary.yaml', { yamlChunking: { mode: 'auto', maxBytes: 1 } })[0].name, 'root');
assert.deepEqual(chunkYaml(text, 'ordinary.yaml', { yamlChunking: { mode: 'auto' } }).map((entry) => entry.name), chunks.map((entry) => entry.name));
assert.equal(chunkYaml('{include: "real", other: 1}', 'ordinary.yaml', topContext)[0].name, 'root', 'top-level section layout does not widen to inline flow maps');
const multi = '---\nfirst: 1\ninclude: "one.yaml"\n---\nsecond: 2\ninclude: "two.yaml"\n';
assert.deepEqual(chunkYaml(multi, 'multi.yaml', topContext).map((entry) => [entry.name, entry.meta.documentIndex]),
  [['first', 0], ['include', 0], ['second', 1], ['include', 1]]);
assert.deepEqual(collectYamlImports(multi), ['one.yaml', 'two.yaml']);
const opaque = 'notes: >-\n  include: folded.fake\n  ---\n  jobs: phantom\ninclude: "real#part.yaml" # imports: comment.fake';
assert.deepEqual(collectYamlImports(opaque), ['real#part.yaml']);
assert.equal(parseYamlStructure(opaque).documentRanges.length, 1);
const aliases = 'root: &root {include: *root}\ninclude: *root\nimports: [*root, "real.yaml"]\n';
const aliasModel = parseYamlStructure(aliases);
assert.equal(aliasModel.reason, null);
assert.equal(aliasModel.unresolvedAliases, 3);
assert.deepEqual(collectYamlImports(aliases), ['real.yaml'], 'alias cycles are syntax only and never expanded');
const tags = 'include: !unbound "excluded.yaml"\nsource: !unbound {include: "also.excluded"}\nimports: [!!str "real.yaml"]';
assert.equal(parseYamlStructure(tags).reason, null);
assert.equal(parseYamlStructure(tags).unresolvedTags, 2);
assert.deepEqual(collectYamlImports(tags), ['real.yaml'], 'custom-tagged scalar/subtree data remains unresolved');
assert.deepEqual(collectYamlImports('__proto__: {include: "own.yaml"}\nconstructor: {include: "ctor.yaml"}'), ['own.yaml', 'ctor.yaml']);
assert.equal({}.include, undefined);
for (const source of ['include: "old"\ninclude: "new"', 'include: ["real"', 'include: "unterminated',
  'root:\n  child: first\n child: wrong-indent', 'include: {key: value', '%YAML abc\n---\ninclude: "real"']) {
  assert.ok(parseYamlStructure(source).reason, source);
  assert.deepEqual(collectYamlImports(source), []);
  assert.equal(chunkYaml(source, 'bad.yaml', topContext)[0].meta.parserCoverage, 'unavailable');
}
assert.equal(parseYamlStructure('').reason, null);
const unicodeReference = 'notes: "😀"\ninclude: "😀.yaml"';
const unicodeEntry = parseYamlStructure(unicodeReference).importEntries[0];
assert.equal(unicodeReference.slice(unicodeEntry.start, unicodeEntry.end), '"😀.yaml"');
assert.equal(unicodeEntry.end - unicodeEntry.start, '"😀.yaml"'.length);
assert.deepEqual(collectYamlImports('import: "old"\n"im\\u0070ort": "new"'), [], 'escaped duplicate keys are still invalid');
const unknownDirective = '%UNKNOWN directive\n---\ninclude: "real"';
assert.deepEqual(collectYamlImports(unknownDirective), ['real'], 'ignored directives remain explicit warnings, not invented fatal syntax errors');
assert.ok(parseYamlStructure(unknownDirective).warningCodes.includes('BAD_DIRECTIVE'));
let loads = 0;
const missing = createYamlStructureParser({ loadParser: () => { loads += 1; throw Error('Controlled missing parser'); } });
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(missing(text).reason, 'parser-unavailable');
assert.equal(loads, 1);
assert.deepEqual(createYamlImportCollector({ parseStructure: missing })(text), []);
assert.equal(createYamlChunker({ parseStructure: missing })(text, 'config.yaml', topContext)[0].meta.parserFallbackReason, 'parser-unavailable');
assert.equal(createYamlChunker({ parseStructure: missing })(text, '.github/workflows/inert.yaml', {})[0].name, 'workflow');
assert.equal(createYamlChunker({ parseStructure: forbidden })(text, 'config.yaml', {})[0].name, 'root', 'generic root mode does not initialize a parser');
assert.equal(createYamlStructureParser({ loadParser: () => ({}) })(text).reason, 'parser-unsupported');
const stable = createYamlStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(786433)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(20000)).reason, 'line-limit');
assert.equal(stable('include: "' + 'x'.repeat(32769) + '"').reason, 'token-length-limit');
assert.equal(stable('values: [' + '0,'.repeat(32769) + '0]').reason, 'token-limit');
assert.equal(stable('values: [' + '0,'.repeat(20000) + '0]').reason, 'node-limit');
assert.equal(stable('---\ninclude: "x"\n'.repeat(65)).reason, 'document-limit');
let compositions = 0;
class CountComposer extends vendor.Composer {
  *compose(...args) { compositions += 1; yield* super.compose(...args); }
}
const bounded = createYamlStructureParser({ now: () => 0, loadParser: () => ({ ...vendor, Composer: CountComposer }) });
assert.equal(bounded('values: ' + '['.repeat(65) + '0' + ']'.repeat(65)).reason, 'depth-limit');
assert.equal(bounded(Array.from({ length: 66 }, (_, index) => ' '.repeat(index * 2) + 'key:').join('\n')).reason, 'depth-limit');
assert.equal(compositions, 0, 'flow/CST admission rejects deep input before recursive document composition');
const corrupt = (modify) => {
  class CorruptComposer extends vendor.Composer {
    *compose(...args) { for (const document of super.compose(...args)) { modify(document); yield document; } }
  }
  return createYamlStructureParser({ now: () => 0, loadParser: () => ({ ...vendor, Composer: CorruptComposer }) });
};
assert.equal(corrupt((document) => { document.contents.items[0].key.range = [-1, 3, 3]; })('include: "real"').reason, 'invalid-node-range');
assert.equal(corrupt((document) => { document.contents.range = [0, 4, 4]; })('include: "real"').reason, 'invalid-child-range');
assert.equal(corrupt((document) => { document.contents.items[0].value = document.contents; })('include: "real"').reason, 'cyclic-node');
const expired = createYamlStructureParser();
assert.equal(expired('include: "real"', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(expired('include: "real"', { remainingMs: () => NaN }).reason, 'time-limit');
assert.equal(expired('include: "real"').reason, null);
assert.equal(expired('include: "real"', { remainingMs: () => 0 }).reason, 'time-limit', 'cache hits preserve caller admission');
for (const mode of ['chunk', 'import']) {
  let clock = 0;
  class SlowComposer extends vendor.Composer {
    *compose(...args) { for (const document of super.compose(...args)) { clock += 11; yield document; } }
  }
  const parseStructure = createYamlStructureParser({ now: () => clock, loadParser: () => ({ ...vendor, Composer: SlowComposer }) });
  const source = 'include: "real"';
  if (mode === 'chunk') assert.equal(createYamlChunker({ parseStructure })(source, 'config.yaml',
    { ...topContext, treeSitter: { byLanguage: { yaml: { maxParseMs: 10 } } } })[0].meta.parserFallbackReason, 'time-limit');
  else assert.deepEqual(createYamlImportCollector({ parseStructure })(source,
    { collectorNow: () => clock, collectorScanBudget: { maxMs: 10 } }), []);
  clock = 0;
  assert.equal(parseStructure(source, { maxMs: 10 }).metrics.measuredOverrunMs, 1);
}
assert.deepEqual(collectYamlImports('include: ["first","second"]', { collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectYamlImports('include: ["first","second"]', { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['first']);
assert.deepEqual(collectYamlImports('include:\n - "first"\n - "excluded"', { collectorScanBudget: { maxLines: 2, maxMs: 0 } }), ['first']);
assert.deepEqual(collectYamlImports('include: "first"\nimport: "excluded"', { collectorScanBudget: { maxLines: 1, maxMs: 0 } }), ['first']);
let clock = 0;
const cold = createYamlStructureParser({ now: () => clock, initializationNow: () => clock,
  loadParser: () => { clock += 60; return vendor; } });
assert.deepEqual(createYamlImportCollector({ parseStructure: cold })('include: "real"',
  { collectorNow: () => clock, collectorScanBudget: { maxMs: 30 } }), ['real']);
assert.equal(cold.initialize().elapsedMs, 60);
clock = 0;
const coldChunk = createYamlStructureParser({ now: () => clock, initializationNow: () => clock,
  loadParser: () => { clock += 60; return vendor; } });
assert.equal(createYamlChunker({ parseStructure: coldChunk, now: () => clock })('include: "real"',
  'config.yaml', topContext)[0].name, 'include');
assert.equal(coldChunk.initialize().elapsedMs, 60);
clock = 0;
const assemble = createYamlChunker({ parseStructure: () => model, now: () => (clock += 6) });
const assemblyExpired = assemble(text, 'config.yaml', { ...topContext, treeSitter: { maxParseMs: 10 } })[0];
assert.equal(assemblyExpired.meta.parserFallbackReason, 'time-limit', 'chunk assembly remains inside the same document owner deadline');
assert.equal(assemblyExpired.meta.parseMetrics.ownerMeasuredOverrunMs, 2);
console.log('YAML syntax-node ownership rejects scalar phantoms and keeps aliases/tags inert under exact caller/resource bounds');
