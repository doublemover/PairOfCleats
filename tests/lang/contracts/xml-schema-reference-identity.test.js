import assert from 'node:assert/strict';
import { createXmlStructureParser } from '../../../src/shared/xml-structure.js';
import { createXmlImportCollector } from '../../../src/index/language-registry/import-collectors/xml.js';

const XSI = 'http://www.w3.org/2001/XMLSchema-instance', XSD = 'http://www.w3.org/2001/XMLSchema';
const parse = createXmlStructureParser({ now: () => 0 });
const collector = createXmlImportCollector({ parseStructure: parse });
const collect = (source, options = {}) => collector(source, { collectorNow: () => 0, ...options });
const values = source => parse(source).importEntries.map(entry => entry.value);
const pairs = `<root xmlns:s="${XSI}" s:schemaLocation="urn:one one.xsd urn:two two.xsd"/>`;
assert.deepEqual(values(pairs), ['one.xsd', 'two.xsd']);
assert.deepEqual(parse(pairs).importEntries.map(entry => entry.targetNamespace), ['urn:one', 'urn:two']);
assert.ok(parse(pairs).importEntries.every(entry => entry.role === 'xsi-schema-location-pair'));
assert.deepEqual(values(pairs.replaceAll('xmlns:s=', 'xmlns:xsi=').replaceAll('s:schemaLocation', 'xsi:schemaLocation')), ['one.xsd', 'two.xsd']);
assert.deepEqual(values(`<root s:schemaLocation="urn:one schema" xmlns:s="${XSI}"/>`), ['schema'], 'later declarations belong to the complete tag');
assert.deepEqual(values(`<root xmlns:s="${XSI}" s:noNamespaceSchemaLocation="schema"/>`), ['schema']);
assert.deepEqual(values(`<root xmlns="${XSI}" schemaLocation="urn:one schema"/>`), [], 'default namespaces do not bind attributes');
assert.deepEqual(values('<root s:schemaLocation="urn:one wrong.xsd"/>'), []);
assert.equal(parse('<root s:schemaLocation="urn:one wrong.xsd"/>').importCoverage.state, 'partial');
const wrong = `<root xmlns:s="urn:application" s:schemaLocation="urn:one wrong.xsd"/>`;
assert.deepEqual(values(wrong), []);
assert.equal(parse(wrong).referenceObservations[0].reason, 'schema-attribute-other-namespace');
assert.deepEqual(values(`<root xmlns:s="${XSI}" s:SchemaLocation="urn:one wrong.xsd"/>`), [], 'expanded local names are case-sensitive');
const odd = `<root xmlns:s="${XSI}" s:schemaLocation="urn:one one.xsd urn:two"/>`;
assert.deepEqual(values(odd), [], 'odd lists cannot reshuffle or silently admit a guessed prefix');
assert.ok(parse(odd).importCoverage.reasons.includes('schema-location-pairs'));
const manySingles = `<root xmlns:s="${XSI}" s:noNamespaceSchemaLocation="one.xsd two.xsd"/>`;
assert.deepEqual(values(manySingles), []);
assert.ok(parse(manySingles).importCoverage.reasons.includes('schema-location-single'));
const scope = `<root xmlns:s="${XSI}"><a xmlns:s="urn:application" s:noNamespaceSchemaLocation="wrong.xsd"/>`
  + '<b s:noNamespaceSchemaLocation="right.xsd"/><c xmlns:s="urn:application"><d s:noNamespaceSchemaLocation="nested-wrong.xsd"/></c>'
  + '<e s:noNamespaceSchemaLocation="last.xsd"/></root>';
assert.deepEqual(values(scope), ['right.xsd', 'last.xsd'], 'nested/empty-element declarations cannot leak into siblings');
const schema = `<schema xmlns="${XSD}"><include schemaLocation="bare"/><import namespace="urn:external" schemaLocation="external.xsd"/>`
  + '<IMPORT schemaLocation="case-wrong.xsd"/></schema>';
assert.deepEqual(values(schema), ['bare', 'external.xsd']);
assert.ok(parse(schema).importEntries.every(entry => entry.role === 'xsd-schema-location'));
const legacy = '<root xmlns:a="urn:application"><a:include schemaLocation="literal-schema"/><include href="literal.xml"/></root>';
assert.deepEqual(values(legacy), ['literal-schema', 'literal.xml']);
assert.ok(parse(legacy).importEntries.every(entry => entry.role === 'xml-config-heuristic'), 'compatibility evidence is explicitly heuristic');
const duplicate = `<root xmlns:s="${XSI}" xmlns:t="${XSI}" s:schemaLocation="urn:a a.xsd" t:schemaLocation="urn:b b.xsd"/>`;
assert.deepEqual(values(duplicate), []);
assert.ok(parse(duplicate).importCoverage.reasons.includes('duplicate-expanded-attribute'));
const unresolved = `<!DOCTYPE root [<!ENTITY hint "external.xsd">]><root xmlns:s="${XSI}" s:noNamespaceSchemaLocation="&hint;"/>`;
assert.deepEqual(values(unresolved), []);
assert.equal(parse(unresolved).ignoredDeclarations, 1);
assert.ok(parse(unresolved).importCoverage.reasons.includes('unresolved-reference-value'));
const unicode = `<root note="🧪" s:schemaLocation="urn:one one.xsd" xmlns:s="${XSI}"/>`;
const entry = parse(unicode).importEntries[0];
assert.equal(unicode.slice(entry.start, entry.end), 'one.xsd');
assert.equal(unicode.slice(entry.namespaceRange.start, entry.namespaceRange.end), 'urn:one');
assert.equal(unicode.slice(entry.nameRange.start, entry.nameRange.end), 's:schemaLocation');
assert.equal(unicode.slice(entry.valueRange.start, entry.valueRange.end), 'urn:one one.xsd');
assert.equal(entry.start, unicode.indexOf('one.xsd'));
assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.expandedName));
for (const key of ['maxTokens', 'maxMatches']) {
  const admitted = collect(pairs, { collectorScanBudget: { [key]: 1, maxMs: 0 } });
  assert.deepEqual(admitted, ['one.xsd'], key);
  assert.equal(admitted.occurrences[0].targetNamespace, 'urn:one');
  assert.equal(admitted.coverage.state, 'partial');
}
assert.equal(collect(odd).coverage.state, 'partial');
const rejectedFirst = `<root xmlns:s="${XSI}" s:schemaLocation="urn:oversize ${'x'.repeat(4097)} urn:valid schema"/>`;
assert.deepEqual(collect(rejectedFirst, { collectorScanBudget: { maxTokens: 1, maxMatches: 1, maxMs: 0 } }), ['schema'],
  'unsupported literals and namespace metadata cannot consume the only admitted dependency slot');
const abort = new AbortController(); abort.abort();
assert.equal(collect(pairs, { abortSignal: abort.signal }).coverage.state, 'cancelled', 'cached models still enforce caller cancellation');
console.log('XML expanded schema reference identities test passed');
