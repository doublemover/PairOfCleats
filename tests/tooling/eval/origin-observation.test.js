import assert from 'node:assert/strict';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash } from '../../helpers/task-span-trace-fixture.js';
import { taskTraceSourceKey } from '../../../src/retrieval/evaluation/task-span-trace.js';
import { evaluateOriginObservations, compareOriginObservations } from '../../../src/retrieval/evaluation/origin-observation.js';
import { getInterventionAdapter } from '../../../tools/eval/interventions/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/origin-observation/')[1];
assert.ok(['one-origin-many-paths', 'same-text-independent-origins', 'unknown-stale-and-invalid-traces', 'paired-scope-and-ownership'].includes(mode));
const origin = id => ({ id: hash(id), dependenceGroupId: hash('group-' + id), independence: 'declared-independent-with-assumptions', assumptionIds: [hash('authored-generators-independent')] });
const make = () => {
  const trace = makeTaskSpanTrace(); return { schemaVersion: 1, trace, origins: [origin('one')],
    sourceBindings: trace.sources.map(source => ({ sourceKey: source.key, originIds: [hash('one')],
      lineage: source === trace.sources[0] ? 'authored-origin' : 'declared-quotation-lineage', lineageReceiptId: hash('lineage-' + source.file) })), edges: [] };
};
const addRetrieved = (input, source = 0) => {
  const sequence = 7; input.trace.terminalSequence = sequence;
  input.trace.events.push({ ...structuredClone(input.trace.events[0]), id: 'additional-route', sequence,
    span: { ...input.trace.events[0].span, sourceKey: input.trace.sources[source].key }, rank: 4 });
};
if (mode === 'one-origin-many-paths') {
  const adapter = await getInterventionAdapter('origin-observation-v1'), before = make(), after = make(); addRetrieved(after, 1);
  before.edges = [
    { id: hash('transfer'), runKey: before.trace.identity.runKey, fromEventId: 'event-0', toEventId: 'event-4', kind: 'observed-transfer', reporterId: 'fixture', receiptId: hash('transfer-receipt') },
    { id: hash('citation'), runKey: before.trace.identity.runKey, fromEventId: 'event-0', toEventId: 'event-3', kind: 'citation', reporterId: 'fixture', receiptId: hash('citation-receipt') },
    { id: hash('hypothesis'), runKey: before.trace.identity.runKey, fromEventId: 'event-3', toEventId: 'event-0', kind: 'hypothesis', reporterId: 'fixture', receiptId: hash('hypothesis-receipt') }];
  const baseline = await adapter.evaluate(before), treatment = await adapter.evaluate(after);
  assert.equal(baseline.complete, true); assert.equal(treatment.complete, true);
  assert.equal(baseline.stageOrigins.retrieved.distinctOriginIds, 1); assert.equal(baseline.stageOrigins.retrieved.repeatedOriginIncidences, 2);
  assert.equal(treatment.stageOrigins.retrieved.acceptedEvents, 4); assert.equal(treatment.stageOrigins.retrieved.distinctOriginIds, 1);
  assert.equal(treatment.stageOrigins.retrieved.declaredIndependentGroups, 1);
  const comparison = adapter.compare(baseline, treatment);
  assert.equal(comparison.comparisons.retrieved.sameObservedOrigins, true); assert.equal(comparison.comparisons.retrieved.distinctOriginDelta, 0);
  assert.equal(comparison.comparisons.retrieved.repeatedIncidenceDelta, 1); assert.equal(comparison.comparisons.retrieved.declaredIndependentGroupDelta, 0);
  assert.equal(baseline.edgeSummary['observed-transfer'].supplied, 1); assert.equal(baseline.edgeSummary.citation.supplied, 1);
  assert.equal(baseline.edgeSummary.hypothesis.supplied, 1); assert.equal(comparison.causalStatus, 'observational-only');
} else if (mode === 'same-text-independent-origins') {
  const input = make();
  const generators = [() => Buffer.from('authored-source-origin'.padEnd(100, 'x')),
    () => Buffer.from(['authored', 'source', 'origin'].join('-').padEnd(100, 'x'))];
  const authoredBytes = generators.map(generate => generate());
  assert.notEqual(authoredBytes[0], authoredBytes[1]); assert.deepEqual(authoredBytes[0], authoredBytes[1]);
  const changedKeys = new Map();
  input.trace.sources.forEach((source, index) => {
    const previous = source.key; source.contentDigest = hash(authoredBytes[index]); source.byteLength = authoredBytes[index].length;
    source.key = taskTraceSourceKey(source); changedKeys.set(previous, source.key);
  });
  for (const event of input.trace.events) if (event.span) event.span.sourceKey = changedKeys.get(event.span.sourceKey);
  for (const span of [...input.trace.gold, ...input.trace.claims.flatMap(claim => claim.citations)]) span.sourceKey = changedKeys.get(span.sourceKey);
  for (const source of input.sourceBindings) source.sourceKey = changedKeys.get(source.sourceKey);
  input.sourceBindings[1].originIds = [hash('two')]; input.sourceBindings[1].lineage = 'authored-origin';
  input.origins.push(origin('two')); addRetrieved(input, 1);
  const result = await evaluateOriginObservations(input); assert.equal(result.complete, true);
  assert.equal(result.stageOrigins.retrieved.distinctOriginIds, 2); assert.equal(result.stageOrigins.retrieved.declaredIndependentGroups, 2,
    'equal bytes from authored independent generators must not collapse by content digest');
  input.origins[1].independence = 'unknown'; input.origins[1].dependenceGroupId = null; input.origins[1].assumptionIds = [];
  const unknown = await evaluateOriginObservations(input);
  assert.equal(unknown.stageOrigins.retrieved.distinctOriginIds, 2); assert.equal(unknown.stageOrigins.retrieved.declaredIndependentGroups, 1);
  assert.equal(unknown.stageOrigins.retrieved.unknownIndependenceOrigins, 1);
  input.origins[1].independence = 'known-dependent'; input.origins[1].dependenceGroupId = input.origins[0].dependenceGroupId;
  const dependent = await evaluateOriginObservations(input);
  assert.equal(dependent.stageOrigins.retrieved.distinctOriginIds, 2); assert.equal(dependent.stageOrigins.retrieved.knownDependenceGroups, 1);
} else if (mode === 'unknown-stale-and-invalid-traces') {
  const incomplete = make(); incomplete.sourceBindings.pop();
  const result = await evaluateOriginObservations(incomplete); assert.equal(result.stageOrigins.explored.unknownLineageEvents, 1);
  assert.equal(result.stageOrigins.explored.observationCoverage, 'partial-or-unknown');
  const noUse = make(); noUse.trace.events = noUse.trace.events.filter(event => event.stage !== 'used'); noUse.trace.stages.used = 'unknown';
  const partial = await evaluateOriginObservations(noUse);
  assert.equal(partial.stageOrigins.used.distinctOriginIds, 0); assert.equal(partial.stageOrigins.used.observationCoverage, 'partial-or-unknown');
  assert.equal(compareOriginObservations(await evaluateOriginObservations(make()), partial).comparisons.used.distinctOriginDelta, null);
  const stale = make(); stale.trace.events[0].span.generation = hash('old-world');
  const old = await evaluateOriginObservations(stale); assert.equal(old.stageOrigins.retrieved.acceptedEvents, 2);
  assert.equal(old.stageOrigins.retrieved.rejectedOrUnknownEvents, 1); assert.equal(old.stageOrigins.retrieved.observationCoverage, 'partial-or-unknown');
  for (const mutate of [value => { value.trace.events.push(structuredClone(value.trace.events[0])); },
    value => { value.edges = [{ id: hash('edge'), runKey: hash('another-run'), fromEventId: 'event-0', toEventId: 'event-4', kind: 'observed-transfer', reporterId: 'fixture', receiptId: hash('receipt') }]; },
    value => { value.edges = [{ id: hash('backward'), runKey: value.trace.identity.runKey, fromEventId: 'event-4', toEventId: 'event-0', kind: 'reported-parent', reporterId: 'fixture', receiptId: hash('receipt') }]; },
    value => { value.edges = [{ id: hash('fabricated-span'), runKey: value.trace.identity.runKey, fromEventId: 'event-0', toEventId: 'event-3', kind: 'observed-transfer', reporterId: 'fixture', receiptId: hash('receipt') }]; },
    value => { value.origins.push(structuredClone(value.origins[0])); }, value => { value.origins[0].assumptionIds = []; }]) {
    const invalid = make(); mutate(invalid); await assert.rejects(evaluateOriginObservations(invalid));
  }
} else {
  const input = make(), pending = evaluateOriginObservations(input); input.origins[0].independence = 'unknown';
  const captured = await pending; assert.equal(captured.stageOrigins.retrieved.declaredIndependentGroups, 1);
  assert.throws(() => compareOriginObservations({ ...captured }, captured), { code: 'ERR_ORIGIN_OBSERVATION_CONTRACT' });
  const changed = make(); changed.origins[0].independence = 'unknown'; changed.origins[0].assumptionIds = [];
  const other = await evaluateOriginObservations(changed);
  assert.throws(() => compareOriginObservations(captured, other), { code: 'ERR_ORIGIN_OBSERVATION_CONTRACT' });
  const different = make(); different.trace.identity.taskKey = hash('another-task');
  const differentReceipt = await evaluateOriginObservations(different);
  assert.throws(() => compareOriginObservations(captured, differentReceipt), { code: 'ERR_ORIGIN_OBSERVATION_CONTRACT' });
  const bounded = await evaluateOriginObservations(make(), { maxOutputBytes: 1024 }); assert.equal(bounded.complete, false);
  assert.equal(bounded.stageOrigins, null); assert.throws(() => compareOriginObservations(captured, bounded));
  let reads = 0; const accessor = make(); Object.defineProperty(accessor.origins[0], 'id', { enumerable: true, get() { reads++; return hash('one'); } });
  await assert.rejects(evaluateOriginObservations(accessor)); assert.equal(reads, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(evaluateOriginObservations(make(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(captured.sourceTruth, 'not-independently-revalidated'); assert.equal(captured.decision, null);
}
console.log('Origin telemetry distinguishes repeated routes, equal-text independent inputs and unknown evidence without causal promotion.');
