import assert from 'node:assert/strict';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapGroupedAdjacency, applyGroupedAdjacencyDelta, describeGroupedAdjacency } from '../../../src/index/semantic/views/grouped-adjacency.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/grouped-adjacency/')[1];
assert.ok(['weighted-counts-and-provenance', 'retract-extrema-and-last-support', 'partial-domain-observations',
  'atomic-replay-and-original-handles', 'bounded-and-cancelled-transitions', 'independent-expanded-bag'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'group-' + revision, semanticRevision: 0 }, repositoryNamespace: 'group-fixture', contextKey: 'context' });
const inputDefinition = { viewId: 'input', producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'input-domain', algebra: 'signed-occurrence-bag-v1' };
const definition = { schemaVersion: 1, id: 'groups', operator: 'grouped-adjacency', ruleVersion: '1',
  configHash: 'b'.repeat(64), domainId: 'group-domain', inputDomainId: 'input-domain', groupBy: 'from' };
const row = (id, from = 'g', to = 'a', multiplicity = '1') => ({ occurrenceId: 'occurrence:' + id, supportId: id, from, to, multiplicity, sourceRef: 'source:' + id });
const bootstrap = (rows = [], { complete = true, revision = 0, limits, groupBy = 'from' } = {}) => {
  const input = bootstrapAdjacencyView({ definition: inputDefinition, world: world(revision), rows, complete });
  return bootstrapGroupedAdjacency({ definition: { ...definition, groupBy }, input, ...(limits ? { limits } : {}) });
};
const batch = (view, id, revision, edits = [], complete = true) => {
  const report = describeGroupedAdjacency(view);
  return { batchId: id, expectedRootId: view.rootId, input: { batchId: id + ':input', definition: inputDefinition,
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRootId, edits, capturedDomainComplete: complete } };
};
const relationRows = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { const page = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(page.state, 'exhausted'); return page.items; }
  finally { cursor.close(); }
};
if (mode === 'weighted-counts-and-provenance') {
  const adapter = await getOfflineEvaluationAdapter('finite-grouped-adjacency-v1');
  assert.equal(adapter.bootstrap, bootstrapGroupedAdjacency);
  const parents = [row('a', 'g', 'a', '2'), row('m', 'g', 'm', '3'), row('z', 'g', 'z'), row('q', 'h', 'q')];
  const view = bootstrap(parents), report = adapter.inspect(view);
  assert.equal(report.rows.length, 2); const group = report.rows[0];
  assert.deepEqual({ key: group.key, supports: group.supportCount, copies: group.weightedCount, distinct: group.distinctValueCount,
    min: group.minimum, max: group.maximum }, { key: 'g', supports: 3, copies: '6', distinct: 3, min: 'a', max: 'z' });
  assert.deepEqual(group.alternatives, parents.slice(0, 3)); assert.equal(group.status, 'exact-in-captured-domain');
  const facts = relationRows(view); assert.equal(facts.length, 2); assert.ok(facts.every(fact => fact.occurrences.every(parent => parent.sourceRef === null)));
  assert.equal(facts.find(fact => fact.tuple.key === 'g').tuple.weightedCount, '6'); assert.equal(view.publication, 'private-unpublished'); assert.equal(view.semanticClosure, 'not-implied');
  assert.match(adapter.work(view).strategy, /full-affected/);
  assert.deepEqual(describeGroupedAdjacency(bootstrap(parents, { groupBy: 'to' })).rows.map(group => group.key), ['a', 'm', 'q', 'z']);
} else if (mode === 'retract-extrema-and-last-support') {
  const low = row('low', 'g', 'a', '2'), middle = row('middle', 'g', 'm'), high = row('high', 'g', 'z');
  const original = bootstrap([low, middle, high]);
  let current = applyGroupedAdjacencyDelta(original, batch(original, 'remove-low', 1, [{ ...low, multiplicity: '-2' }])).view;
  assert.equal(describeGroupedAdjacency(current).rows[0].minimum, 'm'); assert.equal(describeGroupedAdjacency(original).rows[0].minimum, 'a');
  current = applyGroupedAdjacencyDelta(current, batch(current, 'remove-high', 2, [{ ...high, multiplicity: '-1' }])).view;
  assert.equal(describeGroupedAdjacency(current).rows[0].maximum, 'm');
  current = applyGroupedAdjacencyDelta(current, batch(current, 'remove-last', 3, [{ ...middle, multiplicity: '-1' }])).view;
  assert.deepEqual(describeGroupedAdjacency(current).rows, []); assert.equal(current.relation.cardinality, '0');
} else if (mode === 'partial-domain-observations') {
  const partial = bootstrap([row('known', 'g', 'm', '2')], { complete: false });
  const report = describeGroupedAdjacency(partial); assert.equal(report.rows[0].weightedCount, '2');
  assert.equal(report.rows[0].status, 'observed-in-incomplete-domain'); assert.equal(report.capturedDomainComplete, false);
  assert.equal(partial.relation.cardinality, '0', 'partial counts or extrema are not emitted as exact aggregate facts');
  const complete = applyGroupedAdjacencyDelta(partial, batch(partial, 'complete-domain', 1, [], true)).view;
  assert.equal(describeGroupedAdjacency(complete).rows[0].status, 'exact-in-captured-domain'); assert.equal(complete.relation.cardinality, '1');
  const partialAgain = applyGroupedAdjacencyDelta(complete, batch(complete, 'lose-domain', 2, [], false)).view;
  assert.equal(partialAgain.relation.cardinality, '0'); assert.equal(complete.relation.cardinality, '1');
} else if (mode === 'atomic-replay-and-original-handles') {
  const original = bootstrap(), change = batch(original, 'one', 1, [row('one')]);
  const next = applyGroupedAdjacencyDelta(original, change); assert.equal(next.consumed, true);
  assert.equal(applyGroupedAdjacencyDelta(next.view, change).view, next.view);
  assert.throws(() => applyGroupedAdjacencyDelta(next.view, { ...change, input: { ...change.input, edits: [] } }), /changed content/);
  assert.throws(() => applyGroupedAdjacencyDelta(next.view, { ...batch(next.view, 'wrong-base', 2), expectedRootId: original.rootId }), /wrong original base/);
  assert.throws(() => describeGroupedAdjacency({ ...next.view }), /Original/);
  let reads = 0;
  assert.throws(() => bootstrapGroupedAdjacency({ get definition() { reads++; return definition; }, input: {} })); assert.equal(reads, 0);
  const passiveInput = bootstrapAdjacencyView({ definition: inputDefinition, world: world(0), rows: [], complete: true });
  const proxy = new Proxy(definition, { getPrototypeOf() { reads++; throw new Error('proxy trap must not run'); } });
  assert.throws(() => bootstrapGroupedAdjacency({ definition: proxy, input: passiveInput })); assert.equal(reads, 0);
  const decorated = batch(next.view, 'hidden', 2); Object.defineProperty(decorated.input.edits, 'hidden', { value: true });
  assert.throws(() => applyGroupedAdjacencyDelta(next.view, decorated), /decorations/);
  const mutable = batch(original, 'capture', 1, [row('captured')]);
  const captured = applyGroupedAdjacencyDelta(original, mutable, { get signal() { mutable.input.edits[0].from = 'changed'; return null; } });
  assert.equal(describeGroupedAdjacency(captured.view).rows[0].key, 'g');
} else if (mode === 'bounded-and-cancelled-transitions') {
  const original = bootstrap([row('one')], { limits: { groups: 1 } });
  const overflow = applyGroupedAdjacencyDelta(original, batch(original, 'second-group', 1, [row('two', 'h')]));
  assert.equal(overflow.status, 'retention-budget'); assert.equal(overflow.consumed, false); assert.equal(overflow.view, original);
  assert.equal(describeGroupedAdjacency(original).rows.length, 1);
  const abort = new AbortController(); abort.abort();
  assert.equal(applyGroupedAdjacencyDelta(original, batch(original, 'cancelled', 1), { signal: abort.signal }).status, 'cancelled');
  const work = bootstrap([], { limits: { work: 1 } });
  assert.equal(applyGroupedAdjacencyDelta(work, batch(work, 'work', 1, [row('a'), row('b')])).status, 'work-budget');
  assert.throws(() => bootstrap([row('a', 'g', 'a', '8'.repeat(128)), row('b', 'g', 'b', '8'.repeat(128))]), { code: 'ERR_GROUPED_ADJACENCY_BUDGET' });
  assert.throws(() => bootstrapGroupedAdjacency({ definition: { ...definition, inputDomainId: 'other' },
    input: bootstrapAdjacencyView({ definition: inputDefinition, world: world(0), rows: [], complete: true }) }), /wrong original domain/);
} else {
  let current = bootstrap(); const state = new Map();
  const trace = [row('a', 'g', 'b', '2'), row('b', 'g', 'a'), row('c', 'h', 'z', '2'), row('a', 'g', 'b'),
    row('b', 'g', 'a', '-1'), row('a', 'g', 'b', '-3'), row('b', 'g', 'a'), row('c', 'h', 'z', '-1'), row('c', 'h', 'z', '-1')];
  for (const [index, edit] of trace.entries()) {
    const count = (state.get(edit.supportId)?.count ?? 0) + Number(edit.multiplicity);
    if (count) state.set(edit.supportId, { ...edit, count }); else state.delete(edit.supportId);
    current = applyGroupedAdjacencyDelta(current, batch(current, 'revision-' + index, index + 1, [edit])).view;
    const copies = [...state.values()].flatMap(item => Array.from({ length: item.count }, () => [item.from, item.to]));
    const expected = [...new Set(copies.map(([from]) => from))].sort().map(group => {
      const values = copies.filter(([from]) => from === group).map(([, to]) => to).sort();
      return { key: group, weightedCount: String(values.length), distinctValueCount: new Set(values).size, minimum: values[0], maximum: values.at(-1) };
    });
    const report = describeGroupedAdjacency(current);
    assert.deepEqual(report.rows.map(({ key, weightedCount, distinctValueCount, minimum, maximum }) => ({ key, weightedCount, distinctValueCount, minimum, maximum })), expected);
    const fresh = bootstrap([...state.values()].map(({ count, ...item }) => ({ ...item, multiplicity: String(count) })), { revision: index + 1 });
    assert.deepEqual(report.rows, describeGroupedAdjacency(fresh).rows); assert.equal(current.relation.rootId, fresh.relation.rootId);
  }
}
console.log('Finite grouped adjacency preserves weighted bags, original alternatives, partial-domain uncertainty and atomic revisions.');
