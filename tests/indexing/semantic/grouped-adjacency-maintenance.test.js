import assert from 'node:assert/strict';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapGroupedAdjacency, applyGroupedAdjacencyDelta, describeGroupedAdjacency,
  groupedAdjacencyWork } from '../../../src/index/semantic/views/grouped-adjacency.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/grouped-adjacency-maintenance/')[1];
assert.ok(['affected-extrema-and-coefficients', 'dense-fallback-and-sparse-resume', 'coverage-and-atomic-groups', 'bounded-cancelled-and-replayed'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'group-maintenance-' + revision, semanticRevision: 0 },
  repositoryNamespace: 'group-maintenance-fixture', contextKey: 'source' });
const inputDefinition = { viewId: 'input', producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: 'source', algebra: 'signed-occurrence-bag-v1' };
const definition = { schemaVersion: 1, id: 'groups', operator: 'grouped-adjacency', ruleVersion: '1',
  configHash: 'b'.repeat(64), domainId: 'output', inputDomainId: 'source', groupBy: 'from' };
const row = (id, from, to, multiplicity = '1') => ({ occurrenceId: id, supportId: 'support:' + id, from, to, multiplicity, sourceRef: 'source:' + id });
const initial = () => [...Array.from({ length: 200 }, (_, index) => row('big:' + index, 'big', 'value:' + index)),
  row('small:a', 'small', 'a', '2'), row('small:m', 'small', 'm'), row('small:z', 'small', 'z')];
const bootstrap = (rows, revision = 0, complete = true, limits, groupBy = 'from') => bootstrapGroupedAdjacency({ definition: { ...definition, groupBy },
  input: bootstrapAdjacencyView({ definition: inputDefinition, world: world(revision), rows, complete }), ...(limits ? { limits } : {}) });
const batch = (view, id, revision, edits, complete = true) => {
  const report = describeGroupedAdjacency(view);
  return { batchId: id, expectedRootId: view.rootId, input: { batchId: id + ':input', definition: inputDefinition,
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRootId, edits, capturedDomainComplete: complete } };
};
const facts = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { const result = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(result.state, 'exhausted'); return result.items.map(item => item.tuple); }
  finally { cursor.close(); }
};
const oracle = (view, rows, revision, complete = true, groupBy = 'from') => {
  const fresh = bootstrap(rows, revision, complete, undefined, groupBy), report = describeGroupedAdjacency(view);
  assert.deepEqual(report.rows, describeGroupedAdjacency(fresh).rows, 'all retained parent identities and content match a clean build');
  assert.equal(view.relation.rootId, fresh.relation.rootId); assert.equal(view.relation.cardinality, fresh.relation.cardinality);
  const opposite = groupBy === 'from' ? 'to' : 'from';
  const copies = rows.flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => [row[groupBy], row[opposite]]));
  const expected = [...new Set(copies.map(([group]) => group))].sort().map(group => {
    const values = copies.filter(([key]) => key === group).map(([, value]) => value).sort();
    return { key: group, weightedCount: String(values.length), distinctValueCount: new Set(values).size, minimum: values[0], maximum: values.at(-1) };
  });
  assert.deepEqual(report.rows.map(({ key, weightedCount, distinctValueCount, minimum, maximum }) => ({ key, weightedCount, distinctValueCount, minimum, maximum })), expected);
  assert.equal(facts(view).length, complete ? expected.length : 0, 'incomplete observations never emit exact aggregate facts');
};
if (mode === 'affected-extrema-and-coefficients') {
  for (const groupBy of ['from', 'to']) {
    const rows = initial().map(parent => groupBy === 'to' ? { ...parent, from: parent.to, to: parent.from } : parent);
    let current = bootstrap(rows, 0, true, undefined, groupBy), retained = [...rows];
    const changes = [{ ...rows[200], multiplicity: '-2' }, { ...rows[201], multiplicity: '2' },
      { ...rows[202], multiplicity: '-1' }, { ...rows[201], multiplicity: '-3' }];
    for (const [index, change] of changes.entries()) {
      const previous = retained.find(row => row.supportId === change.supportId), count = Number(previous.multiplicity) + Number(change.multiplicity);
      retained = retained.filter(row => row.supportId !== change.supportId); if (count) retained.push({ ...change, multiplicity: String(count) });
      current = applyGroupedAdjacencyDelta(current, batch(current, 'extremum-' + index, index + 1, [change])).view;
      const work = groupedAdjacencyWork(current);
      assert.equal(work.strategy, 'affected-group-recomputation'); assert.equal(work.recomputedGroups, 1);
      assert.equal(work.derivedGroupHashes, count || index < 3 ? 1 : 0, 'unchanged large-group provenance is not rehashed');
      const rebuilt = bootstrap(retained, index + 1, true, undefined, groupBy);
      assert.ok(work.workUnits < groupedAdjacencyWork(rebuilt).workUnits); oracle(current, retained, index + 1, true, groupBy);
    }
  }
} else if (mode === 'dense-fallback-and-sparse-resume') {
  const rows = initial(), original = bootstrap(rows), edits = rows.slice(0, 100).map(row => ({ ...row, multiplicity: '-1' }));
  const full = applyGroupedAdjacencyDelta(original, batch(original, 'dense', 1, edits)).view;
  assert.equal(groupedAdjacencyWork(full).strategy, 'full-affected-view-recomputation'); oracle(full, rows.slice(100), 1);
  const sparse = applyGroupedAdjacencyDelta(full, batch(full, 'sparse', 2, [{ ...rows[200], multiplicity: '-2' }])).view;
  assert.equal(groupedAdjacencyWork(sparse).strategy, 'affected-group-recomputation'); oracle(sparse, [...rows.slice(100, 200), ...rows.slice(201)], 2);
} else if (mode === 'coverage-and-atomic-groups') {
  const rows = initial(), original = bootstrap(rows, 0, false, { groups: 2 });
  const complete = applyGroupedAdjacencyDelta(original, batch(original, 'complete', 1, [], true)).view;
  assert.equal(groupedAdjacencyWork(complete).strategy, 'affected-group-recomputation');
  assert.equal(groupedAdjacencyWork(complete).recomputedGroups, 0); assert.equal(groupedAdjacencyWork(complete).derivedGroupHashes, 2);
  oracle(complete, rows, 1); assert.equal(original.relation.cardinality, '0');
  const replacement = row('a-new', 'new', 'new-value');
  const replaced = applyGroupedAdjacencyDelta(complete, batch(complete, 'replace', 2,
    [replacement, ...rows.slice(200).map(row => ({ ...row, multiplicity: '-' + row.multiplicity }))])).view;
  assert.equal(groupedAdjacencyWork(replaced).strategy, 'affected-group-recomputation');
  oracle(replaced, [...rows.slice(0, 200), replacement], 2); assert.equal(describeGroupedAdjacency(replaced).rows.length, 2);
  const partial = applyGroupedAdjacencyDelta(replaced, batch(replaced, 'partial', 3, [], false)).view;
  assert.equal(groupedAdjacencyWork(partial).derivedGroupHashes, 0); oracle(partial, [...rows.slice(0, 200), replacement], 3, false);
} else {
  const rows = initial(), original = bootstrap(rows, 0, true, { groups: 2 });
  const overflow = applyGroupedAdjacencyDelta(original, batch(original, 'overflow', 1, [row('third', 'third', 'value')]));
  assert.equal(overflow.status, 'retention-budget'); assert.equal(overflow.consumed, false); assert.equal(overflow.view, original);
  const controller = new AbortController(); controller.abort();
  assert.equal(applyGroupedAdjacencyDelta(original, batch(original, 'cancelled', 1, []), { signal: controller.signal }).status, 'cancelled');
  const change = batch(original, 'once', 1, [{ ...rows[200], multiplicity: '-2' }]);
  const next = applyGroupedAdjacencyDelta(original, change).view;
  assert.equal(applyGroupedAdjacencyDelta(next, change).view, next);
  assert.throws(() => applyGroupedAdjacencyDelta(next, { ...change, input: { ...change.input, edits: [] } }), /changed content/);
  assert.throws(() => applyGroupedAdjacencyDelta(next, batch(original, 'wrong-base', 2, [])), /wrong original base/);
  oracle(original, rows, 0); oracle(next, [...rows.slice(0, 200), ...rows.slice(201)], 1);
}
console.log('Affected-group maintenance retains all alternatives, exact extrema and clean-rebuild relation identity.');
