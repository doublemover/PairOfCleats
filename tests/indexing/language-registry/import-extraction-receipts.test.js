import assert from 'node:assert/strict';
import { createYamlImportCollector } from '../../../src/index/language-registry/import-collectors/yaml.js';
import { createTomlImportCollector } from '../../../src/index/language-registry/import-collectors/toml.js';
import { createProtoImportCollector } from '../../../src/index/language-registry/import-collectors/proto.js';
import { createXmlImportCollector } from '../../../src/index/language-registry/import-collectors/xml.js';
import { collectLanguageImportResult, getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildSimpleRelations } from '../../../src/index/language-registry/simple-relations.js';
import { buildFileRelations, stripFileRelations } from '../../../src/index/build/file-processor/relations.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { collectImports } from '../../../src/lang/javascript/imports.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { installedPackageVersion } from '../../../src/shared/installed-package-version.js';
import { admitImportExtraction, attachImportExtraction, canReuseImportExtraction, createImportExtraction,
  getImportExtraction, projectImportExtraction, summarizeImportExtraction } from '../../../src/shared/import-extraction.js';

for (const parser of ['babel', 'acorn', 'esprima']) {
  for (const source of ['', 'const ordinary = 1;', String.raw`req\u0075ire('./escaped.js');`,
    `import './one.js'; export * from './two.js'; require('./one.js');`]) {
    const ast = parseJavaScriptAst(source, { parser });
    const imports = collectImports(source, { ast });
    const receipt = getImportExtraction(imports);
    assert.equal(canReuseImportExtraction(receipt, imports), true, `${parser}: owned, error-free syntax qualifies its static subset`);
    assert.equal(receipt.parser.id, 'javascript-' + parser);
    assert.equal(receipt.parser.version, installedPackageVersion(parser === 'babel' ? '@babel/parser' : parser));
    assert.equal(receipt.state, 'partial'); assert.equal(receipt.reasonCounts.parser_scope_partial, 1);
    assert.equal(receipt.recognition, imports.length ? 'nonempty' : 'empty');
    if (source.includes('u0075')) assert.deepEqual(imports, ['./escaped.js'], 'keyword prefilters cannot hide escaped callees');
    if (source.startsWith('import')) assert.deepEqual([...imports].sort(), ['./one.js', './two.js']);
    assert.throws(() => admitImportExtraction(receipt, imports, { text: source + '\n' }), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
  }
}
const dynamic = collectImports(`import('./literal.js'); import(variable);`);
assert.deepEqual(dynamic, ['./literal.js']);
assert.equal(getImportExtraction(dynamic).scope, 'javascript-literal-import-export-require-specifiers');
assert.equal(getImportExtraction(dynamic).state, 'partial', 'runtime-constructed imports stay outside the qualified static subset');
const ownedSource = `import './owned.js';`, ownedAst = parseJavaScriptAst(ownedSource);
for (const [text, options] of [
  [ownedSource, { ast: { type: 'Program', body: [] } }],
  [`import './changed.js';`, { ast: ownedAst }],
  ['export const duplicate=1; export const duplicate=2;', {}],
  ['import {', {}],
  [ownedSource, { signal: { aborted: true } }]
]) {
  const imports = collectImports(text, options), receipt = getImportExtraction(imports);
  assert.equal(canReuseImportExtraction(receipt, imports), false, 'foreign/stale/recovered/failed/cancelled syntax never qualifies');
  assert.equal(receipt.reusePolicy, 'refresh-required');
}
const literal = collectLanguageImportResult({ text: `require('thing,'); require('thing'); require('  thing  ');`,
  ext: '.js', relPath: 'literal.js', mode: 'code' });
assert.deepEqual(literal.entries.map(entry => entry.specifier), ['  thing  ', 'thing', 'thing,']);
assert.ok(literal.entries.every(entry => entry.provenance === 'parsed-literal'));
assert.equal(canReuseImportExtraction(literal.receipt, literal.entries), true);

const parserIdentity = { id: 'fixture-reference-parser', version: '1' };
const model = (values = []) => ({ coverage: 'partial', reason: null, sourceLines: 1,
  importEntries: values.map(value => ({ value, endLine: 0 })), importCoverage: { reasons: [] } });
for (const create of [createYamlImportCollector, createTomlImportCollector, createProtoImportCollector, createXmlImportCollector]) {
  for (const [reason, state] of [[null, 'partial'], ['parser-unavailable', 'unavailable'], ['parse-failed', 'invalid'],
    ['depth-limit', 'partial'], ['node-limit', 'partial'], ['parser-unsupported', 'unsupported'], ['cancelled', 'cancelled']]) {
    let calls = 0;
    const parseStructure = () => { calls++; return { ...model(), ...(reason ? { reason, coverage: 'unavailable' } : {}) }; };
    const collector = create({ parseStructure, parserIdentity });
    const entries = collector('empty within the fixture scope', { collectorScanBudget: { maxMs: 0 } });
    const receipt = getImportExtraction(entries);
    assert.equal(calls, 1, `${create.name}/${reason} performs exactly one parse`);
    assert.equal(receipt.state, state, `${create.name}/${reason}`);
    assert.equal(receipt.recognition, reason ? 'unknown' : 'empty');
    assert.equal(receipt.reasonCounts[reason || 'parser_scope_partial'], 1);
    assert.equal(canReuseImportExtraction(receipt, entries), reason === null);
    assert.equal(receipt.counts.dropped, null, 'unknown producer omissions are never zero');
    assert.equal(receipt.source.scannedLength, null, 'admission is not a measured visited source extent');
    assert.equal(receipt.parser.version, '1');
  }
}

for (const [budget, reason] of [[{ maxChars: 3 }, 'source_bytes'], [{ maxTokens: 1 }, 'scan_tokens']]) {
  const collector = createYamlImportCollector({ parseStructure: () => model(['a', 'b']), parserIdentity });
  const entries = collector('include: [a, b]', { collectorScanBudget: { ...budget, maxMs: 0 } });
  const receipt = getImportExtraction(entries);
  assert.equal(receipt.state, 'partial'); assert.ok(receipt.reasonCounts[reason]);
  assert.equal(canReuseImportExtraction(receipt, entries), false);
  if (budget.maxChars) assert.equal(receipt.source.admittedLength, 3);
}
const timed = createYamlImportCollector({ parseStructure: () => model(['a']), parserIdentity });
let tick = 0;
const timedEntries = timed('include: a', { collectorNow: () => tick++ * 10, collectorScanBudget: { maxMs: 5 } });
assert.ok(getImportExtraction(timedEntries).reasonCounts.scan_time, 'a deterministic clock proves collector expiry');
const unidentified = createYamlImportCollector({ parseStructure: () => model() })('empty', { collectorScanBudget: { maxMs: 0 } });
assert.equal(canReuseImportExtraction(getImportExtraction(unidentified), unidentified), false, 'test doubles cannot claim an installed parser identity');

const qualified = entries => attachImportExtraction(entries, createImportExtraction({ entries, text: 'fixture source',
  producerId: 'fixture', parser: { ...parserIdentity, available: true }, parserCoverage: 'complete', scope: 'fixture-static-imports' }));
const distinct = qualified(Array.from({ length: 513 }, (_, i) => `module-${String(i).padStart(3, '0')}`));
const capped = buildSimpleRelations({ imports: distinct });
assert.equal(capped.imports.length, 512);
assert.deepEqual(capped.importExtraction.steps[0], { owner: 'simple-relations', input: 513, retained: 512,
  duplicates: 0, invalid: 0, omitted: 1, limit: 512 });
assert.equal(capped.importExtraction.reasonCounts.projection_limit, 1);
const duplicates = buildSimpleRelations({ imports: qualified(Array(513).fill('same')) });
assert.equal(duplicates.importExtraction.steps[0].duplicates, 512);
assert.equal(duplicates.importExtraction.steps[0].omitted, 0);
assert.equal(duplicates.importExtraction.state, 'complete');
assert.equal(canReuseImportExtraction(duplicates.importExtraction, duplicates.imports), true);
const file = buildFileRelations(capped);
assert.equal(file.importExtraction.reasonCounts.projection_limit, 1);
assert.equal(stripFileRelations(capped).importExtraction, undefined);
assert.equal(validateArtifact('file_relations', [{ file: 'test.yaml', relations: file }]).ok, true);
const missing = structuredClone(file); delete missing.imports;
assert.equal(validateArtifact('file_relations', [{ file: 'test.yaml', relations: missing }]).ok, false);
const rebound = structuredClone(file); rebound.imports[0] = 'another';
assert.equal(validateArtifact('file_relations', [{ file: 'test.yaml', relations: rebound }]).ok, false);
const again = projectImportExtraction(capped.importExtraction, capped.imports, capped.imports, { owner: 'simple-relations', limit: 512 });
assert.equal(again.identity, capped.importExtraction.identity, 'idempotent projection retains the original loss and identity');
const mutable = qualified(['a']); mutable[0] = 'b';
assert.throws(() => getImportExtraction(mutable), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
const hinted = qualified([{ specifier: 'a', provenance: 'parsed-literal', collectorHint: { kind: 'local' } }]);
hinted[0].collectorHint.kind = 'external';
assert.throws(() => getImportExtraction(hinted), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
assert.throws(() => admitImportExtraction(getImportExtraction(distinct), distinct, { text: 'changed source' }), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });

const unsupported = collectLanguageImportResult({ text: 'anything', ext: '.not-a-language', relPath: 'file.not-a-language' });
assert.equal(unsupported.receipt.state, 'unsupported');
assert.equal(unsupported.receipt.recognition, 'unknown');
const adapter = getLanguageForFile('.yaml', 'fixture.yaml');
const original = adapter.collectImportEntries;
let parses = 0;
try {
  adapter.collectImportEntries = () => { parses++; return ['same', 'same']; };
  const legacy = collectLanguageImportResult({ text: 'legacy source', ext: '.yaml', relPath: 'fixture.yaml' });
  assert.equal(parses, 1); assert.deepEqual(legacy.entries.map(entry => entry.specifier), ['same']);
  assert.equal(legacy.receipt.state, 'unqualified');
  assert.equal(legacy.receipt.steps[0].duplicates, 1);
  assert.equal(canReuseImportExtraction(legacy.receipt, legacy.entries), false);
} finally { adapter.collectImportEntries = original; }
const summary = summarizeImportExtraction(new Map([['capped', file], ['legacy', { imports: [] }], ['empty', duplicates]]));
assert.equal(summary.files, 3); assert.equal(summary.partialFiles, 2);
assert.equal(summary.reasonCounts.projection_limit, 1, 'summary counts affected files, not local dropped entries');
assert.equal(summary.states.unqualified, 1);
console.log('Import extraction receipts preserve source qualification, producer failures and exact bounded projections.');
