import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';

const text = 'caller(); outside();', uri = 'file:///hierarchy-ranges/input.js';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'hierarchy-ranges',
  path: 'input.js', language: 'javascript' }).manifest;
const range = (start, end) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } });
const selection = range(0, 6), enclosure = range(0, 9), outside = range(10, 17);
const item = { uri, name: 'caller', kind: 12, range: enclosure, selectionRange: selection, data: { token: 'opaque' } };
const options = { identity: { sourceHash: source.byteHash, sourceUnitId: source.sourceUnitId,
  sessionId: 'session', profileId: 'profile', contextHash: 'a'.repeat(64), uri,
  generation: { baseBuildId: 'fixture', semanticRevision: 0 } },
  consumers: ['navigation', 'hierarchyDetail'], projectReady: 'ready',
  sourceForUri: value => value === uri ? { source, text } : null };
const record = (collector, requestClass, payload, params = { item }) => collector.record({ requestClass,
  params, response: { attempted: true, payload } });

for (const requestClass of ['incomingCalls', 'outgoingCalls']) {
  const collector = createLspObservationCollector({ ...options, maxFacts: 5 });
  const edge = name => requestClass === 'incomingCalls'
    ? { from: { ...item, name }, fromRanges: [selection, selection] }
    : { to: { ...item, name }, fromRanges: [selection, selection] };
  const observation = record(collector, requestClass, [edge('first'), edge('second')]);
  assert.equal(observation.facts.length, 2);
  assert.deepEqual(observation.facts.map(fact => fact.fromRanges.length), [2, 1],
    'related ranges share the same allowance as their primary hierarchy facts');
  assert.equal(observation.factUnits, 5);
  assert.equal(collector.metrics().facts, 5);
  assert.equal(observation.state, 'partial');
  assert.ok(observation.omissions.includes('hierarchy_range_budget'));
  assert.ok(observation.omissions.includes('fact_budget'));
  const before = collector.metrics();
  const exhausted = record(collector, 'definition', [{ uri, range: selection }], { textDocument: { uri } });
  assert.equal(exhausted.reason, 'output_budget');
  assert.deepEqual(collector.metrics(), before, 'another observation cannot open a new related-range allowance');
  assert.equal(observation.raw.length, 2, 'bounded raw protocol evidence remains distinct from partial projected facts');
}
for (const requestClass of ['incomingCalls', 'outgoingCalls']) {
  const collector = createLspObservationCollector(options);
  const body = requestClass === 'incomingCalls' ? { from: item, fromRanges: [outside] }
    : { to: item, fromRanges: [outside] };
  const observation = record(collector, requestClass, [body]);
  assert.equal(observation.facts[0].target.state, 'exact', 'separate target evidence remains independently qualified');
  assert.equal(observation.facts[0].fromRanges[0].state, 'invalid_range');
  assert.equal(observation.facts[0].fromRanges[0].span, null, 'a source-valid range outside the caller cannot become an exact call origin');
  assert.equal(observation.state, 'partial');
  assert.ok(observation.omissions.includes('hierarchy_range_unqualified'));
}
const missingCaller = record(createLspObservationCollector(options), 'outgoingCalls', [{ to: item, fromRanges: [selection] }],
  { textDocument: { uri } });
assert.equal(missingCaller.state, 'partial');
assert.equal(missingCaller.facts[0].fromRanges[0].state, 'invalid_range');
for (const fromRanges of [undefined, null, {}]) {
  const edge = { to: item };
  if (fromRanges !== undefined) edge.fromRanges = fromRanges;
  const observation = record(createLspObservationCollector(options), 'outgoingCalls', [edge]);
  assert.equal(observation.state, 'partial');
  assert.ok(observation.omissions.includes('malformed_hierarchy_ranges'));
}
const empty = record(createLspObservationCollector(options), 'outgoingCalls', [{ to: item, fromRanges: [] }]);
assert.equal(empty.state, 'complete', 'an explicitly observed empty call-site list is a valid protocol observation');
assert.equal(empty.factUnits, 1);
console.log('LSP hierarchy shared fact/range budget and caller ownership test passed');
