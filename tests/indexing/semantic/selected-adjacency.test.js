import assert from 'node:assert/strict';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyDelta, describeSelectedAdjacency } from '../../../src/index/semantic/views/selected-adjacency.js';
import { openOccurrenceCursor, describeOccurrenceRelation } from '../../../src/semantic/relations/factor.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/selected-adjacency/')[1];
assert.ok(['projected-bags-and-parent-identity', 'exact-selection-and-swap', 'partial-domain-and-world-transitions',
  'atomic-replay-and-passive-input', 'bounded-and-cancelled-transitions', 'independent-expanded-bag'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'selected-' + revision, semanticRevision: 0 }, repositoryNamespace: 'selected-fixture', contextKey: 'context' });
const inputDefinition = { viewId: 'input', producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'input-domain', algebra: 'signed-occurrence-bag-v1' };
const definition = { schemaVersion: 1, id: 'selected', operator: 'select-project-adjacency', ruleVersion: '1',
  configHash: 'b'.repeat(64), domainId: 'selected-domain', inputDomainId: 'input-domain',
  whereField: null, whereEquals: null, projectFrom: 'from', projectTo: 'from' };
const row = (id, from = 'g', to = 'a', multiplicity = '1') => ({ occurrenceId: 'occurrence:' + id, supportId: id, from, to, multiplicity, sourceRef: 'source:' + id });
const bootstrap = (rows = [], { complete = true, revision = 0, limits, definition: selected = definition } = {}) => {
  const input = bootstrapAdjacencyView({ definition: inputDefinition, world: world(revision), rows, complete });
  return bootstrapSelectedAdjacency({ definition: selected, input, ...(limits ? { limits } : {}) });
};
const batch = (view, id, revision, edits = [], complete = true) => {
  const report = describeSelectedAdjacency(view);
  return { batchId: id, expectedRootId: view.rootId, input: { batchId: id + ':input', definition: inputDefinition,
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRootId, edits, capturedDomainComplete: complete } };
};
const occurrences = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { const page = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(page.state, 'exhausted'); return page.items; }
  finally { cursor.close(); }
};
if (mode === 'projected-bags-and-parent-identity') {
  const adapter = await getOfflineEvaluationAdapter('finite-selected-adjacency-v1'); assert.equal(adapter.bootstrap, bootstrapSelectedAdjacency);
  const a = row('a', 'g', 'a', '2'), b = row('b', 'g', 'b', '3'); const original = bootstrap([a, b]);
  const report = adapter.inspect(original); assert.equal(report.rows.length, 2); assert.equal(original.relation.cardinality, '5');
  assert.deepEqual(report.rows.map(item => item.parent), [a, b]); assert.equal(new Set(report.rows.map(item => item.supportId)).size, 2);
  const copies = occurrences(original); assert.equal(copies.length, 5);
  assert.ok(copies.every(item => item.tuple.from === 'g' && item.tuple.to === 'g' && item.occurrences[0].sourceRef === null));
  const next = applySelectedAdjacencyDelta(original, batch(original, 'more-copies', 1, [{ ...a, multiplicity: '1' }])).view;
  assert.equal(next.relation.cardinality, '6'); assert.equal(original.relation.cardinality, '5');
  assert.equal(describeSelectedAdjacency(next).rows[0].supportId, report.rows[0].supportId, 'coefficient changes do not replace an unchanged parent support');
  assert.match(adapter.work(next).strategy, /full-affected/);
} else if (mode === 'exact-selection-and-swap') {
  const selected = { ...definition, whereField: 'from', whereEquals: 'g', projectFrom: 'to', projectTo: 'from' };
  const original = bootstrap([row('a'), row('b', 'other', 'g'), row('c', 'G', 'case'), row('d', 'g', 'z', '2')], { definition: selected });
  assert.deepEqual(occurrences(original).map(item => [item.tuple.from, item.tuple.to]), [['a', 'g'], ['z', 'g'], ['z', 'g']]);
  assert.throws(() => bootstrap([], { definition: { ...selected, whereEquals: null } }), /Invalid selected/);
  assert.throws(() => bootstrap([], { definition: { ...selected, projectFrom: 'arbitrary' } }), /Invalid selected/);
  assert.throws(() => bootstrap([], { definition: { ...selected, callback: 'execute' } }), /Unknown/);
} else if (mode === 'partial-domain-and-world-transitions') {
  const parent = row('known', 'g', 'm', '2'), partial = bootstrap([parent], { complete: false });
  assert.equal(partial.relation.cardinality, '2', 'known positive parent copies remain available in an incomplete domain');
  assert.equal(describeOccurrenceRelation(partial.relation).capturedDomainComplete, false);
  const complete = applySelectedAdjacencyDelta(partial, batch(partial, 'complete', 1, [], true)).view;
  assert.equal(describeOccurrenceRelation(complete.relation).capturedDomainComplete, true); assert.equal(complete.relation.cardinality, '2');
  assert.notEqual(partial.relation.rootId, complete.relation.rootId, 'world/coverage changes retain distinct reader identities');
  assert.equal(describeSelectedAdjacency(complete).rows[0].supportId, describeSelectedAdjacency(partial).rows[0].supportId);
  const removed = applySelectedAdjacencyDelta(complete, batch(complete, 'retract-all', 2, [{ ...parent, multiplicity: '-2' }])).view;
  assert.equal(removed.relation.cardinality, '0'); assert.equal(complete.relation.cardinality, '2');
} else if (mode === 'atomic-replay-and-passive-input') {
  const original = bootstrap(), change = batch(original, 'one', 1, [row('one')]);
  const next = applySelectedAdjacencyDelta(original, change).view;
  assert.equal(applySelectedAdjacencyDelta(next, change).view, next);
  assert.throws(() => applySelectedAdjacencyDelta(next, { ...change, input: { ...change.input, edits: [] } }), /changed content/);
  assert.throws(() => applySelectedAdjacencyDelta(next, { ...batch(next, 'stale', 2), expectedRootId: original.rootId }), /wrong original base/);
  assert.throws(() => describeSelectedAdjacency({ ...next }), /Original/);
  let reads = 0; const proxied = batch(next, 'proxy', 2);
  proxied.input.edits = new Proxy([], { ownKeys() { reads++; throw new Error('trap must not run'); } });
  assert.throws(() => applySelectedAdjacencyDelta(next, proxied), /batch proxies/); assert.equal(reads, 0);
  const mutable = batch(original, 'capture', 1, [row('captured')]);
  const captured = applySelectedAdjacencyDelta(original, mutable, { get signal() { mutable.input.edits[0].from = 'changed'; return null; } });
  assert.equal(describeSelectedAdjacency(captured.view).rows[0].from, 'g');
} else if (mode === 'bounded-and-cancelled-transitions') {
  const original = bootstrap([], { limits: { outputSupports: 1 } });
  const stopped = applySelectedAdjacencyDelta(original, batch(original, 'overflow', 1, [row('a'), row('b')]));
  assert.equal(stopped.status, 'retention-budget'); assert.equal(stopped.consumed, false); assert.equal(stopped.view, original);
  assert.equal(original.relation.cardinality, '0');
  const abort = new AbortController(); abort.abort();
  assert.equal(applySelectedAdjacencyDelta(original, batch(original, 'cancelled', 1), { signal: abort.signal }).status, 'cancelled');
  const work = bootstrap([], { limits: { work: 1 } });
  assert.equal(applySelectedAdjacencyDelta(work, batch(work, 'work', 1, [row('a'), row('b')])).status, 'work-budget');
  const foreign = Object.assign(new Error('not an original allowance'), { code: 'ERR_SELECTED_ADJACENCY_BUDGET', limit: 'work' });
  assert.throws(() => applySelectedAdjacencyDelta(original, batch(original, 'foreign', 1), { signal: { get aborted() { throw foreign; } } }), error => error === foreign);
} else {
  const selected = { ...definition, whereField: 'from', whereEquals: 'g', projectFrom: 'to', projectTo: 'to' };
  let current = bootstrap([], { definition: selected }); const state = new Map();
  const trace = [row('a', 'g', 'b', '2'), row('b', 'g', 'b'), row('c', 'h', 'z', '2'), row('a', 'g', 'b'),
    row('b', 'g', 'b', '-1'), row('a', 'g', 'b', '-3'), row('b', 'g', 'b'), row('c', 'h', 'z', '-2')];
  for (const [index, edit] of trace.entries()) {
    const count = (state.get(edit.supportId)?.count ?? 0) + Number(edit.multiplicity);
    if (count) state.set(edit.supportId, { ...edit, count }); else state.delete(edit.supportId);
    current = applySelectedAdjacencyDelta(current, batch(current, 'revision-' + index, index + 1, [edit])).view;
    const expected = [...state.values()].flatMap(item => Array.from({ length: item.count }, () => [item.from, item.to]))
      .filter(([from]) => from === 'g').map(([, to]) => JSON.stringify([to, to])).sort();
    assert.deepEqual(occurrences(current).map(item => JSON.stringify([item.tuple.from, item.tuple.to])).sort(), expected);
    const fresh = bootstrap([...state.values()].map(({ count, ...item }) => ({ ...item, multiplicity: String(count) })), { definition: selected, revision: index + 1 });
    assert.deepEqual(describeSelectedAdjacency(current).rows, describeSelectedAdjacency(fresh).rows);
    assert.equal(current.relation.rootId, fresh.relation.rootId);
  }
}
console.log('Finite selection/projection preserves every parent support, duplicate bag copy and original revision boundary.');
