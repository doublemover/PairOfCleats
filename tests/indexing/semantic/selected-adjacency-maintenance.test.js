import assert from 'node:assert/strict';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyDelta, describeSelectedAdjacency,
  selectedAdjacencyWork } from '../../../src/index/semantic/views/selected-adjacency.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/selected-adjacency-maintenance/')[1];
assert.ok(['sparse-update-and-rebuild-oracle', 'dense-fallback-and-sparse-resume', 'coverage-and-atomic-replacement', 'bounded-cancelled-and-replayed'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'selected-maintenance-' + revision, semanticRevision: 0 },
  repositoryNamespace: 'selected-maintenance-fixture', contextKey: 'source' });
const inputDefinition = { viewId: 'input', producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'source', algebra: 'signed-occurrence-bag-v1' };
const definition = { schemaVersion: 1, id: 'selected', operator: 'select-project-adjacency', ruleVersion: '1',
  configHash: 'b'.repeat(64), domainId: 'output', inputDomainId: 'source', whereField: 'from', whereEquals: 'wanted',
  projectFrom: 'to', projectTo: 'to' };
const row = (id, from = 'other', to = 'destination', multiplicity = '1') => ({ occurrenceId: id, supportId: 'support:' + id,
  from, to, multiplicity, sourceRef: 'source:' + id });
const initial = () => [row('z-original', 'wanted', 'same', '2'), ...Array.from({ length: 200 }, (_, index) => row('irrelevant:' + index))];
const bootstrap = (rows, revision = 0, complete = true, limits) => bootstrapSelectedAdjacency({ definition,
  input: bootstrapAdjacencyView({ definition: inputDefinition, world: world(revision), rows, complete }), ...(limits ? { limits } : {}) });
const batch = (view, id, revision, edits, complete = true) => {
  const report = describeSelectedAdjacency(view);
  return { batchId: id, expectedRootId: view.rootId, input: { batchId: id + ':input', definition: inputDefinition,
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRootId, edits, capturedDomainComplete: complete } };
};
const copies = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { const result = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(result.state, 'exhausted');
    return result.items.map(item => [item.tuple.from, item.tuple.to]); }
  finally { cursor.close(); }
};
const oracle = (view, rows, revision, complete = true) => {
  const fresh = bootstrap(rows, revision, complete);
  assert.deepEqual(describeSelectedAdjacency(view).rows, describeSelectedAdjacency(fresh).rows,
    'all parent content, multiplicities and derived identities equal a clean build');
  assert.equal(view.relation.rootId, fresh.relation.rootId); assert.equal(view.relation.cardinality, fresh.relation.cardinality);
  const expected = rows.filter(row => row.from === 'wanted').flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => [row.to, row.to]));
  assert.deepEqual(copies(view).sort(), expected.sort(), 'an independent tiny-copy model checks actual emitted projection');
};
if (mode === 'sparse-update-and-rebuild-oracle') {
  const rows = initial(), original = bootstrap(rows), change = { ...rows[0], multiplicity: '1' };
  const next = applySelectedAdjacencyDelta(original, batch(original, 'coefficient', 1, [change])).view;
  const work = selectedAdjacencyWork(next);
  assert.equal(work.strategy, 'incremental-selected-supports'); assert.equal(work.derivedSupportHashes, 0);
  assert.ok(work.workUnits < selectedAdjacencyWork(bootstrap([{ ...rows[0], multiplicity: '3' }, ...rows.slice(1)], 1)).workUnits);
  oracle(next, [{ ...rows[0], multiplicity: '3' }, ...rows.slice(1)], 1); assert.equal(original.relation.cardinality, '2');
  const inserted = row('a-second', 'wanted', 'same', '2'), added = applySelectedAdjacencyDelta(next, batch(next, 'new-support', 2, [inserted])).view;
  assert.equal(selectedAdjacencyWork(added).derivedSupportHashes, 1); assert.equal(describeSelectedAdjacency(added).rows.length, 2);
  oracle(added, [{ ...rows[0], multiplicity: '3' }, ...rows.slice(1), inserted], 2);
} else if (mode === 'dense-fallback-and-sparse-resume') {
  const rows = initial(), original = bootstrap(rows);
  const dense = rows.slice(1, 151).map(row => ({ ...row, multiplicity: '-1' }));
  const rebuilt = applySelectedAdjacencyDelta(original, batch(original, 'dense', 1, dense)).view;
  assert.equal(selectedAdjacencyWork(rebuilt).strategy, 'full-affected-view-recomputation'); oracle(rebuilt, [rows[0], ...rows.slice(151)], 1);
  const sparse = applySelectedAdjacencyDelta(rebuilt, batch(rebuilt, 'sparse', 2, [{ ...rows[0], multiplicity: '1' }])).view;
  assert.equal(selectedAdjacencyWork(sparse).strategy, 'incremental-selected-supports');
  oracle(sparse, [{ ...rows[0], multiplicity: '3' }, ...rows.slice(151)], 2);
} else if (mode === 'coverage-and-atomic-replacement') {
  const rows = initial(), original = bootstrap(rows, 0, false, { outputSupports: 1 });
  const next = applySelectedAdjacencyDelta(original, batch(original, 'coverage', 1, [], true)).view;
  assert.equal(selectedAdjacencyWork(next).strategy, 'incremental-selected-supports'); assert.equal(selectedAdjacencyWork(next).derivedSupportHashes, 0);
  assert.equal(describeSelectedAdjacency(next).capturedDomainComplete, true); oracle(next, rows, 1);
  const replacement = row('a-replacement', 'wanted', 'new', '3');
  const replaced = applySelectedAdjacencyDelta(next, batch(next, 'replace', 2, [replacement, { ...rows[0], multiplicity: '-2' }])).view;
  assert.equal(selectedAdjacencyWork(replaced).strategy, 'incremental-selected-supports');
  assert.equal(describeSelectedAdjacency(replaced).rows.length, 1); oracle(replaced, [replacement, ...rows.slice(1)], 2);
  const partial = applySelectedAdjacencyDelta(replaced, batch(replaced, 'partial', 3, [], false)).view;
  assert.equal(describeSelectedAdjacency(partial).capturedDomainComplete, false); oracle(partial, [replacement, ...rows.slice(1)], 3, false);
} else {
  const rows = initial(), original = bootstrap(rows, 0, true, { outputSupports: 1 });
  const overflow = applySelectedAdjacencyDelta(original, batch(original, 'overflow', 1, [row('new', 'wanted')]));
  assert.equal(overflow.status, 'retention-budget'); assert.equal(overflow.consumed, false); assert.equal(overflow.view, original);
  const controller = new AbortController(); controller.abort();
  assert.equal(applySelectedAdjacencyDelta(original, batch(original, 'cancelled', 1, []), { signal: controller.signal }).status, 'cancelled');
  const change = batch(original, 'once', 1, [{ ...rows[0], multiplicity: '1' }]);
  const next = applySelectedAdjacencyDelta(original, change).view;
  assert.equal(applySelectedAdjacencyDelta(next, change).view, next);
  assert.throws(() => applySelectedAdjacencyDelta(next, { ...change, input: { ...change.input, edits: [] } }), /changed content/);
  assert.throws(() => applySelectedAdjacencyDelta(next, batch(original, 'old-base', 2, [])), /wrong original base/);
  oracle(original, rows, 0); oracle(next, [{ ...rows[0], multiplicity: '3' }, ...rows.slice(1)], 1);
}
console.log('Finite selective maintenance preserves exact rebuild and occurrence-copy oracles across sparse and dense strategies.');
