import assert from 'node:assert/strict';
import { bootstrapAdjacencyView, applyAdjacencyDelta, lookupAdjacencyView }
  from '../../../src/index/semantic/views/adjacency-delta.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const definition = { viewId: 'dependency-edge', producerId: 'extractor', producerEpoch: 'epoch-1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'module-domain', algebra: 'signed-occurrence-bag-v1' };
const world = revision => ({ generation: { baseBuildId: 'build', semanticRevision: revision },
  repositoryNamespace: 'repo', contextKey: 'config' });
const row = (supportId, multiplicity = '1', from = 'a', to = 'b') => ({
  occurrenceId: 'occurrence:' + supportId, supportId, from, to, multiplicity, sourceRef: 'source:' + supportId });
const initialRows = [row('first'), row('second')];
const base = bootstrapAdjacencyView({ definition, world: world(0), rows: initialRows, complete: true });
const batch = (view, batchId, revision, edits) => ({ batchId, definition, fromWorld: view.world, toWorld: world(revision),
  baseRoot: view.rootId, edits, capturedDomainComplete: true });
const firstBatch = batch(base, 'remove-first', 1, [row('first', '-1')]);
const first = applyAdjacencyDelta(base, firstBatch);
assert.equal(first.view.relation.cardinality, '1');
assert.deepEqual(first.membershipChanges, []);
assert.equal(first.supportChanges[0].multiplicity, '-1');
assert.equal(lookupAdjacencyView(base, 'a').supports.length, 2);
assert.equal(lookupAdjacencyView(first.view, 'a').supports.length, 1);
assert.equal(applyAdjacencyDelta(first.view, firstBatch).status, 'replayed');
assert.throws(() => applyAdjacencyDelta(first.view, { ...firstBatch, edits: [] }), /replay changed content/);
const second = applyAdjacencyDelta(first.view, batch(first.view, 'remove-second', 2, [row('second', '-1')]));
assert.deepEqual(second.membershipChanges, [{ from: 'a', to: 'b', polarity: -1 }]);
assert.equal(lookupAdjacencyView(second.view, 'a').observation, 'absent-in-captured-domain');
const replacement = applyAdjacencyDelta(base, batch(base, 'replace-support', 1, [row('first', '-1'), row('third')]));
assert.equal(replacement.supportChanges.length, 2);
assert.deepEqual(replacement.membershipChanges, []);
assert.equal(replacement.view.relation.cardinality, '2');
assert.throws(() => applyAdjacencyDelta(base, batch(base, 'invalid', 1, [row('absent', '-1')])), /negative accumulated/);
assert.throws(() => applyAdjacencyDelta(base, batch(base, 'mutation', 1, [row('first', '1', 'different')])), /payload changed/);
assert.throws(() => applyAdjacencyDelta(first.view, batch(base, 'stale', 1, [])), /wrong base/);
const altered = { ...definition, ruleVersion: '2' };
assert.throws(() => applyAdjacencyDelta(base, { ...batch(base, 'model', 1, []), definition: altered }), /rebuild required/);
assert.equal(applyAdjacencyDelta(base, firstBatch, { maxWork: 0 }).consumed, false);
const controller = new AbortController(); controller.abort();
assert.equal(applyAdjacencyDelta(base, firstBatch, { signal: controller.signal }).status, 'cancelled');
assert.equal(base.relation.cardinality, '2');
const partial = bootstrapAdjacencyView({ definition, world: world(0), rows: [], complete: false });
assert.equal(lookupAdjacencyView(partial, 'missing').observation, 'unknown');
const becomesPresent = applyAdjacencyDelta(partial, batch(partial, 'new-import', 1, [row('export', '1', 'missing')]));
assert.equal(lookupAdjacencyView(becomesPresent.view, 'missing').observation, 'present');
assert.notEqual(lookupAdjacencyView(partial, 'missing').dependency.rootId,
  lookupAdjacencyView(becomesPresent.view, 'missing').dependency.rootId);

// Independent flat multiset oracle: each physical support is counted by repeated expansion.
let current = base;
const oracle = new Map(initialRows.map(item => [item.supportId, { ...item }]));
for (let revision = 1; revision <= 40; revision++) {
  const supportId = 'added-' + revision, addition = row(supportId, String(1 + revision % 3), 'n' + revision % 4, 'n' + revision % 5);
  const edits = [addition];
  if (revision > 1) { const prior = oracle.get('added-' + (revision - 1)); edits.push({ ...prior, multiplicity: '-' + prior.multiplicity }); }
  for (const edit of edits) {
    if (edit.multiplicity.startsWith('-')) oracle.delete(edit.supportId); else oracle.set(edit.supportId, edit);
  }
  current = applyAdjacencyDelta(current, batch(current, 'step-' + revision, revision, edits)).view;
  const cursor = openOccurrenceCursor({ relation: current.relation });
  const actual = cursor.next({ limit: 256 }).items.map(item => [item.tuple.from, item.tuple.to].join(':')).sort(); cursor.close();
  const expected = [];
  for (const item of oracle.values()) for (let index = 0; index < Number(item.multiplicity); index++) expected.push(item.from + ':' + item.to);
  assert.deepEqual(actual, expected.sort());
  const rebuilt = bootstrapAdjacencyView({ definition, world: world(revision), rows: [...oracle.values()], complete: true });
  assert.equal(current.relation.rootId, rebuilt.relation.rootId);
}
const huge = bootstrapAdjacencyView({ definition, world: world(0), rows: [row('large', '9007199254740993')], complete: true });
assert.equal(applyAdjacencyDelta(huge, batch(huge, 'large-delete', 1, [row('large', '-1')])).view.relation.cardinality, '9007199254740992');
console.log('private adjacency delta contract passed');
