import assert from 'node:assert/strict';
import { createXmlStructureParser, parseXmlStructure } from '../../../src/shared/xml-structure.js';
import { createXmlChunker, chunkXml } from '../../../src/index/chunking/formats/xml.js';
import { createXmlImportCollector, collectXmlImports } from '../../../src/index/language-registry/import-collectors/xml.js';
import { collectLanguageImports } from '../../../src/index/language-registry/registry.js';
import { buildConfigFileAdapters } from '../../../src/index/language-registry/adapters/config-files.js';

globalThis.fetch = () => { throw Error('Excluded external reference/DTD fetching'); };
const text = ['<root>', '  <![CDATA[😀 > <include href="cdata.fake"/><phony/>]]>',
  '  <!-- <include href="comment.fake"/> -->', '  <?example include="instruction.fake"?>',
  '  <include', '    href="real.xml"/>', '  <last/>', '</root>'].join('\r\n');
const model = parseXmlStructure(text);
assert.equal(model.parser, 'xml-lexical');
assert.equal(model.coverage, 'partial');
assert.equal(model.rangeSource, 'application-utf16-lexer');
assert.equal(parseXmlStructure(text), model);
assert.ok(Object.isFrozen(model) && Object.isFrozen(model.sections[0].attributes));
assert.deepEqual(model.sections.map((entry) => entry.name), ['include', 'last']);
assert.deepEqual(model.importEntries.map((entry) => entry.value), ['real.xml']);
assert.equal(text.slice(model.importEntries[0].start, model.importEntries[0].end), 'real.xml');
assert.equal(text.slice(model.importEntries[0].nameRange.start, model.importEntries[0].nameRange.end), 'href');
assert.equal(model.sections[0].start, text.lastIndexOf('<include'));
assert.equal(text.slice(model.sections[0].start, model.sections[0].end), '<include\r\n    href="real.xml"/>');
assert.deepEqual(collectXmlImports(text), ['real.xml']);
assert.deepEqual(collectLanguageImports({ text, ext: '.xml', relPath: 'project.xml', mode: 'code' }), ['real.xml']);
const chunks = chunkXml(text, {});
assert.deepEqual(chunks.map((entry) => entry.name), ['include', 'last']);
assert.ok(chunks.every((entry) => entry.meta.parserCoverage === 'partial'
  && entry.meta.astRange === undefined && entry.meta.rangeSource === 'application-utf16-lexer'));
assert.equal(chunks[0].end, chunks[1].start);
assert.equal(chunks[0].meta.lexicalElementRange.end, model.sections[0].end);
const adapter = buildConfigFileAdapters().find((entry) => entry.id === 'xml');
assert.deepEqual(adapter.buildRelations({ text, options: {} }).imports, ['real.xml']);
const quoted = '<root>\n <item text=">"/>\n <include href="greater>name.xml"/>\n <last/>\n</root>';
assert.deepEqual(chunkXml(quoted, {}).map((entry) => entry.name), ['item', 'include', 'last']);
assert.deepEqual(collectXmlImports(quoted), ['greater>name.xml']);
const namespace = '<root xsi:schemaLocation="urn:real schema.xsd">'
  + '<cfg:include href="local.xml" SRC="upper.xml"/><cfg:worker/><include href="second.xml"/></root>';
assert.deepEqual(collectXmlImports(namespace), ['urn:real', 'schema.xsd', 'local.xml', 'upper.xml', 'second.xml']);
assert.deepEqual(chunkXml(namespace, {}).map((entry) => entry.name), ['cfg:include', 'cfg:worker', 'include']);
assert.deepEqual(collectXmlImports('<root>text xsi:schemaLocation="not-an-attribute.xsd"</root>'), []);
const unicode = '<根><😀名/><!-- 😀 --><include href="😀.xml"/></根>';
assert.equal(parseXmlStructure(unicode).reason, null);
assert.deepEqual(chunkXml(unicode, {}).map((entry) => entry.name), ['😀名', 'include']);
const unicodeEntry = parseXmlStructure(unicode).importEntries[0];
assert.equal(unicode.slice(unicodeEntry.start, unicodeEntry.end), '😀.xml');
assert.equal(unicodeEntry.end - unicodeEntry.start, '😀.xml'.length);
const declarations = '<!DOCTYPE root [<!ENTITY example "<include href=\'decl.fake\'/>">'
  + '<!-- > ] --><?data ] >?>]><root><include href="literal.xml"/><include href="&example;"/></root>';
const declarationModel = parseXmlStructure(declarations);
assert.equal(declarationModel.reason, null);
assert.equal(declarationModel.ignoredDeclarations, 1);
assert.equal(declarationModel.unresolvedReferences, 1);
assert.deepEqual(collectXmlImports(declarations), ['literal.xml']);
for (const reference of ['&amp;', '&#65;', '&#x1F600;', '&custom;']) {
  const source = `<root><include href="before${reference}after.xml"/></root>`;
  assert.equal(parseXmlStructure(source).reason, null);
  assert.equal(parseXmlStructure(source).unresolvedReferences, 1);
  assert.deepEqual(collectXmlImports(source), [], 'even inline entity/character references remain unresolved, never guessed or expanded');
}
for (const source of ['<root><include href="real"/></other>', '<root><include href="real"/>',
  '<root><include href="unclosed></root>', '<root><!-- unclosed', '<root><![CDATA[unclosed',
  '<root><?unclosed', '<root><!-- bad--comment --></root>', '<root/> <other/>', '<root a="1" a="2"/>',
  '<root a="raw<value"/>', '<root a="bad&value"/>', '<root a="&#0;"/>', '<root>bad]]>text</root>',
  '<!DOCTYPE root [unclosed><root/>', '<root><!DOCTYPE nested></root>', '<root \u0000="invalid"/>',
  '<root>\ud800</root>', '\u00a0<root/>']) {
  assert.ok(parseXmlStructure(source).reason, source);
  assert.deepEqual(collectXmlImports(source), []);
  assert.equal(chunkXml(source, {})[0].meta.parserCoverage, 'unavailable');
}
assert.deepEqual(collectXmlImports(''), []);
assert.equal(chunkXml('', {})[0].name, 'root');
const unavailable = () => ({ reason: 'controlled-unavailable', parser: 'xml-unavailable', coverage: 'unavailable',
  sections: [], importEntries: [], metrics: {} });
assert.deepEqual(createXmlImportCollector({ parseStructure: unavailable })(text), []);
assert.equal(createXmlChunker({ parseStructure: unavailable })(text, {})[0].meta.parserFallbackReason, 'controlled-unavailable');
const stable = createXmlStructureParser({ now: () => 0 });
assert.equal(stable('x'.repeat(786433)).reason, 'source-limit');
assert.equal(stable('\n'.repeat(20000)).reason, 'line-limit');
assert.equal(stable('<root>' + 'x'.repeat(32769) + '</root>').reason, 'token-length-limit');
assert.equal(stable('<' + 'a'.repeat(4097) + '/>').reason, 'name-length-limit');
assert.equal(stable('<root>' + '<!--x-->'.repeat(65536) + '</root>').reason, 'token-limit');
assert.equal(stable('<root>' + '<n/>'.repeat(20000) + '</root>').reason, 'node-limit');
assert.equal(stable('<n>'.repeat(65) + '</n>'.repeat(65)).reason, 'depth-limit');
assert.equal(stable('<root>' + '<include href="x"/>'.repeat(4097) + '</root>').reason, 'import-limit');
const expired = createXmlStructureParser();
assert.equal(expired('<root/>', { remainingMs: () => 0 }).reason, 'time-limit');
assert.equal(expired('<root/>', { remainingMs: () => NaN }).reason, 'time-limit');
assert.equal(expired('<root/>').reason, null);
assert.equal(expired('<root/>', { remainingMs: () => 0 }).reason, 'time-limit', 'cached results preserve actual caller admission');
let clock = 0;
const expiringScan = createXmlStructureParser({ now: () => (clock += 4) });
assert.equal(expiringScan('<root>' + 'x'.repeat(1024) + '</root>', { maxMs: 10 }).reason, 'time-limit');
clock = 0;
const lateCaller = createXmlStructureParser({ now: () => 0 });
assert.deepEqual(createXmlImportCollector({ parseStructure: lateCaller })(text,
  { collectorNow: () => (clock += 5), collectorScanBudget: { maxMs: 10 } }), []);
clock = 0;
let ownerClock = 0;
const callerAdmission = createXmlChunker({ now: () => ownerClock, parseStructure: (source, options) => {
  ownerClock = 7;
  assert.equal(options.remainingMs(), 3, 'document owner remaining time reaches the shared lexical scan');
  return model;
} });
assert.equal(callerAdmission(text, { treeSitter: { byLanguage: { xml: { maxParseMs: 10 } } } })[0].meta.parser, 'xml-lexical');
const assemble = createXmlChunker({ parseStructure: () => model, now: () => (clock += 6) });
const expiredAssembly = assemble(text, { treeSitter: { byLanguage: { xml: { maxParseMs: 10 } } } })[0];
assert.equal(expiredAssembly.meta.parserFallbackReason, 'time-limit');
assert.equal(expiredAssembly.meta.parseMetrics.ownerMeasuredOverrunMs, 2);
const parts = '<root>\n<include href="first.xml"/>\n<include\n href="excluded.xml"/>\n</root>';
assert.deepEqual(collectXmlImports(parts, { collectorScanBudget: { maxLines: 2, maxMs: 0 } }), ['first.xml']);
assert.deepEqual(collectXmlImports(namespace, { collectorScanBudget: { maxTokens: 1, maxMs: 0 } }), ['urn:real']);
assert.deepEqual(collectXmlImports(namespace, { collectorScanBudget: { maxMatches: 1, maxMs: 0 } }), ['urn:real']);
assert.equal(JSON.stringify(chunkXml(namespace, {})), JSON.stringify(chunkXml(namespace, {})), 'unchanged successful results remain deterministic');
console.log('XML lexical ownership respects quoted delimiters/CDATA and exact UTF-16 ranges without declaration/entity resolution');
