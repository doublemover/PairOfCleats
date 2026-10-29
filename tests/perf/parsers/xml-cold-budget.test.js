import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseXmlStructure } from '../../../src/shared/xml-structure.js';
import { chunkXml } from '../../../src/index/chunking/formats/xml.js';
import { collectXmlImports } from '../../../src/index/language-registry/import-collectors/xml.js';
import { collectLanguageImports } from '../../../src/index/language-registry/registry.js';
import { buildConfigFileAdapters } from '../../../src/index/language-registry/adapters/config-files.js';
import { sourceSections } from '../../lang/helpers/source-sections.js';

// These default APIs keep their production 30 ms owner/scan budgets. Run in
// the serial runtime cohort: functional grammar checks have a separate clock.
globalThis.fetch = () => { throw Error('Excluded external reference/DTD fetching'); };
const text = ['<root>', '  <![CDATA[😀 > <include href="cdata.fake"/><phony/>]]>',
  '  <!-- <include href="comment.fake"/> -->', '  <?example include="instruction.fake"?>',
  '  <include', '    href="real.xml"/>', '  <last/>', '</root>'].join('\r\n');
const quoted = '<root>\n <item text=">"/>\n <include href="greater>name.xml"/>\n <last/>\n</root>';
const cases = [
  [text, ['include', 'last'], ['real.xml']],
  [quoted, ['item', 'include', 'last'], ['greater>name.xml']],
  ['<root><include href="literal.xml"/><last/></root>', ['include', 'last'], ['literal.xml']]
];
const samples = [];
const adapter = buildConfigFileAdapters().find(entry => entry.id === 'xml');
for (const [source, names, imports] of cases) {
  // Consecutive APIs share the production one-entry cache; switching input
  // starts a cold scan. Both states must retain the original content positives.
  for (const state of ['cold', 'warm']) {
    const started = performance.now();
    const model = parseXmlStructure(source);
    const parseCallMs = performance.now() - started;
    assert.equal(model.reason, null, JSON.stringify({ state, ...model.metrics }));
    assert.deepEqual(model.sections.map(entry => entry.name), names);
    assert.equal(model.metrics.localLimitMs, 30);
    assert.equal(model.metrics.effectiveLimitMsAtEntry, 30);
    assert.ok(model.metrics.elapsedMs < 30, 'the production scan deadline remains unchanged');
    assert.equal(parseXmlStructure(source), model, 'successful default parses share the bounded cache');
    const chunks = chunkXml(source, {});
    assert.deepEqual(sourceSections(source, chunks).map(entry => entry.name), names, JSON.stringify(chunks.map(entry => entry.meta)));
    assert.ok(chunks.every(entry => entry.meta.parserCoverage === 'partial'
      && entry.meta.astRange === undefined && entry.meta.rangeSource === 'application-utf16-lexer'));
    assert.ok(chunks.every(entry => entry.meta.parseMetrics.ownerLimitMs === 30));
    assert.deepEqual(collectXmlImports(source), imports);
    assert.deepEqual(collectLanguageImports({ text: source, ext: '.xml', relPath: 'project.xml', mode: 'code' }), imports);
    assert.deepEqual(adapter.buildRelations({ text: source, options: {} }).imports, imports);
    samples.push({ state, sourceSha256: createHash('sha256').update(source).digest('hex'), characters: source.length,
      parseCallMs, retainedScanMs: model.metrics.elapsedMs,
      pipelineMs: performance.now() - started, ownerLimitMs: chunks[0].meta.parseMetrics.ownerLimitMs });
  }
}
console.log(JSON.stringify({ qualification: 'XML default APIs, production 30 ms scan/owner bounds',
  runtime: { node: process.version, platform: process.platform, arch: process.arch }, samples }));
