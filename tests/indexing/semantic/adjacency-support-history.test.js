import assert from 'node:assert/strict';
import { ADJACENCY_VIEW_VERSION, bootstrapAdjacencyView, applyAdjacencyDelta } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyDelta, describeSelectedAdjacency } from '../../../src/index/semantic/views/selected-adjacency.js';
import { bootstrapGroupedAdjacency, applyGroupedAdjacencyDelta, describeGroupedAdjacency } from '../../../src/index/semantic/views/grouped-adjacency.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/adjacency-support-history/')[1];
assert.ok(['retracted-support-binding', 'net-zero-support-binding', 'bounded-history-and-work', 'derived-owner-binding'].includes(mode));
const definition = { viewId: 'input', producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'input-domain', algebra: 'signed-occurrence-bag-v1' };
const world = revision => ({ generation: { baseBuildId: 'history-' + revision, semanticRevision: 0 }, repositoryNamespace: 'fixture', contextKey: 'context' });
const row = (id, multiplicity = '1') => ({ occurrenceId: 'o:' + id, supportId: String(id), from: 'a', to: 'b', multiplicity, sourceRef: null });
const bootstrap = rows => bootstrapAdjacencyView({ definition, world: world(0), rows, complete: true });
const batch = (view, id, revision, edits) => ({ batchId: id, definition, fromWorld: view.world, toWorld: world(revision),
  baseRoot: view.rootId, edits, capturedDomainComplete: true });
if (mode === 'retracted-support-binding') {
  const parent = row('original'), original = bootstrap([parent]);
  assert.equal(original.version, ADJACENCY_VIEW_VERSION);
  const retired = applyAdjacencyDelta(original, batch(original, 'remove', 1, [{ ...parent, multiplicity: '-1' }])).view;
  assert.equal(retired.supportCount, 0); assert.equal(retired.knownSupportCount, 1);
  for (const changed of [{ ...parent, from: 'changed' }, { ...parent, to: 'changed' }, { ...parent, sourceRef: 'changed-source' }]) {
    assert.throws(() => applyAdjacencyDelta(retired, batch(retired, 'restore', 2, [changed])), /payload changed/);
  }
  const restored = applyAdjacencyDelta(retired, batch(retired, 'restore', 2, [parent]));
  assert.equal(restored.consumed, true); assert.equal(restored.view.relation.cardinality, '1');
  assert.equal(restored.view.knownSupportCount, 1); assert.equal(retired.relation.cardinality, '0'); assert.equal(original.relation.cardinality, '1');
} else if (mode === 'net-zero-support-binding') {
  const parent = row('cancelled'), original = bootstrap([]);
  const zero = applyAdjacencyDelta(original, batch(original, 'net-zero', 1, [parent, { ...parent, multiplicity: '-1' }])).view;
  assert.equal(zero.relation.cardinality, '0'); assert.equal(zero.knownSupportCount, 1);
  assert.throws(() => applyAdjacencyDelta(zero, batch(zero, 'reuse', 2, [{ ...parent, from: 'different' }])), /payload changed/);
  const restored = applyAdjacencyDelta(zero, batch(zero, 'restore', 2, [parent])).view;
  const fresh = bootstrapAdjacencyView({ definition, world: world(2), rows: [parent], complete: true });
  assert.equal(restored.relation.rootId, fresh.relation.rootId, 'logical occurrence bags still agree with a clean source declaration');
  assert.notEqual(restored.rootId, fresh.rootId, 'private revision roots retain their actual admitted history');
} else if (mode === 'bounded-history-and-work') {
  const rows = Array.from({ length: 16384 }, (_, index) => row(index));
  const original = bootstrap(rows);
  const retired = applyAdjacencyDelta(original, batch(original, 'remove-all', 1, rows.map(parent => ({ ...parent, multiplicity: '-1' }))), { maxWork: 65536 }).view;
  assert.equal(retired.supportCount, 0); assert.equal(retired.knownSupportCount, 16384);
  const checkpoint = applyAdjacencyDelta(retired, batch(retired, 'new-id', 2, [row('new')]));
  assert.equal(checkpoint.status, 'checkpoint-required'); assert.equal(checkpoint.consumed, false); assert.equal(checkpoint.view, retired);
  const stop = applyAdjacencyDelta(retired, batch(retired, 'restore', 2, [rows[0]]), { maxWork: 16384 });
  assert.equal(stop.status, 'work-budget'); assert.equal(stop.view, retired, 'retained bindings count toward transition work');
  const restored = applyAdjacencyDelta(retired, batch(retired, 'restore', 2, [rows[0]])).view;
  assert.equal(restored.supportCount, 1); assert.equal(restored.knownSupportCount, 16384);
} else {
  const parent = row('parent');
  const common = { schemaVersion: 1, id: 'derived', ruleVersion: '1', configHash: 'b'.repeat(64), domainId: 'derived-domain', inputDomainId: 'input-domain' };
  for (const owner of [{ bootstrap: bootstrapGroupedAdjacency, apply: applyGroupedAdjacencyDelta, inspect: describeGroupedAdjacency,
    definition: { ...common, operator: 'grouped-adjacency', groupBy: 'from' } },
  { bootstrap: bootstrapSelectedAdjacency, apply: applySelectedAdjacencyDelta, inspect: describeSelectedAdjacency,
    definition: { ...common, operator: 'select-project-adjacency', whereField: null, whereEquals: null, projectFrom: 'from', projectTo: 'to' } }]) {
    const original = owner.bootstrap({ definition: owner.definition, input: bootstrap([parent]) });
    const change = (view, id, revision, edits) => {
      const report = owner.inspect(view);
      return { batchId: id, expectedRootId: view.rootId, input: { batchId: id + ':input', definition,
        fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRootId, edits, capturedDomainComplete: true } };
    };
    const retired = owner.apply(original, change(original, 'remove', 1, [{ ...parent, multiplicity: '-1' }])).view;
    assert.equal(retired.relation.cardinality, '0');
    assert.throws(() => owner.apply(retired, change(retired, 'restore', 2, [{ ...parent, to: 'changed' }])), /payload changed/);
    const restored = owner.apply(retired, change(retired, 'restore', 2, [parent])).view;
    assert.equal(restored.relation.cardinality, '1'); assert.equal(retired.relation.cardinality, '0');
  }
}
console.log('Original support payloads remain bound after full or net-zero retraction within a bounded private revision chain.');
