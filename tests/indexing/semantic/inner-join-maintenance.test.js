import assert from 'node:assert/strict';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapRelationalJoin, applyRelationalJoinDelta, describeRelationalJoin,
  relationalJoinWork } from '../../../src/index/semantic/views/relational-join.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/inner-join-maintenance/')[1];
assert.ok(['simultaneous-role-terms', 'signed-products-and-atomic-coefficients', 'dense-and-capacity-fallback', 'partial-domain-and-replay', 'independent-revision-oracle'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'join-maintenance-' + revision, semanticRevision: 0 },
  repositoryNamespace: 'join-maintenance-fixture', contextKey: 'source' });
const inputDefinition = side => ({ viewId: side, producerId: 'fixture', producerEpoch: '1', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: side, algebra: 'signed-occurrence-bag-v1' });
const definition = { schemaVersion: 1, id: 'join', operator: 'inner-join', ruleVersion: '1',
  configHash: 'b'.repeat(64), domainId: 'output', leftDomainId: 'left', rightDomainId: 'right' };
const row = (id, from = 'k', to = 'k', multiplicity = '1') => ({ occurrenceId: id, supportId: 'support:' + id, from, to, multiplicity, sourceRef: 'source:' + id });
const padding = () => Array.from({ length: 120 }, (_, index) => row('irrelevant:' + index, 'source:' + index, 'unmatched:' + index));
const bootstrap = (leftRows, rightRows, revision = 0, complete = true, limits, operator = 'inner-join') => bootstrapRelationalJoin({ definition: { ...definition, operator },
  left: bootstrapAdjacencyView({ definition: inputDefinition('left'), world: world(revision), rows: leftRows, complete }),
  right: bootstrapAdjacencyView({ definition: inputDefinition('right'), world: world(revision), rows: rightRows, complete }), ...(limits ? { limits } : {}) });
const batch = (view, id, revision, left, right, complete = true) => {
  const report = describeRelationalJoin(view), input = (side, edits) => ({ batchId: id + ':' + side, definition: inputDefinition(side),
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRoots[side], edits, capturedDomainComplete: complete });
  return { batchId: id, expectedRootId: view.rootId, left: input('left', left), right: input('right', right) };
};
const copies = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try { const result = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(result.state, 'exhausted');
    return result.items.map(item => JSON.stringify([item.tuple.from, item.tuple.to])).sort(); }
  finally { cursor.close(); }
};
const oracle = (view, left, right, revision, complete = true, expand = true) => {
  const fresh = bootstrap(left, right, revision, complete);
  assert.deepEqual(describeRelationalJoin(view).rows, describeRelationalJoin(fresh).rows, 'all role-qualified parents and counts match a clean build');
  assert.equal(view.relation.rootId, fresh.relation.rootId); assert.equal(view.relation.cardinality, fresh.relation.cardinality);
  if (!expand) return;
  const expanded = rows => rows.flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => [row.from, row.to]));
  const expected = [];
  for (const a of expanded(left)) for (const b of expanded(right)) if (a[1] === b[0]) expected.push(JSON.stringify([a[0], b[1]]));
  assert.deepEqual(copies(view), expected.sort(), 'independent ordered occurrence pairs detect missing or double-counted mixed terms');
};
if (mode === 'simultaneous-role-terms') {
  const shared = row('same-origin', 'k', 'k', '2'), unrelated = padding();
  const original = bootstrap([shared, ...unrelated], [shared]); assert.equal(original.relation.cardinality, '4');
  const next = applyRelationalJoinDelta(original, batch(original, 'two-to-three', 1,
    [{ ...shared, multiplicity: '1' }], [{ ...shared, multiplicity: '1' }])).view;
  assert.equal(next.relation.cardinality, '9', 'the two roles add five new ordered occurrence pairs, not four or six');
  const work = relationalJoinWork(next); assert.equal(work.strategy, 'role-ordered-inner-join');
  assert.equal(work.incrementalPairTerms, 2); assert.equal(work.derivedSupportHashes, 0);
  assert.equal(describeRelationalJoin(next).rows[0].supportId, describeRelationalJoin(original).rows[0].supportId);
  oracle(next, [{ ...shared, multiplicity: '3' }, ...unrelated], [{ ...shared, multiplicity: '3' }], 1);
  assert.ok(work.workUnits < relationalJoinWork(bootstrap([{ ...shared, multiplicity: '3' }, ...unrelated], [{ ...shared, multiplicity: '3' }], 1)).workUnits);
} else if (mode === 'signed-products-and-atomic-coefficients') {
  const shared = row('same-origin', 'k', 'k', '3'), unrelated = padding();
  const original = bootstrap([shared, ...unrelated], [shared]);
  const reduced = applyRelationalJoinDelta(original, batch(original, 'three-to-two', 1,
    [{ ...shared, multiplicity: '-1' }], [{ ...shared, multiplicity: '-1' }])).view;
  assert.equal(reduced.relation.cardinality, '4'); assert.equal(relationalJoinWork(reduced).strategy, 'role-ordered-inner-join');
  oracle(reduced, [{ ...shared, multiplicity: '2' }, ...unrelated], [{ ...shared, multiplicity: '2' }], 1);
  const large = 10n ** 127n, l = row('L'), r = row('R', 'k', 'k', large.toString());
  const huge = bootstrap([l, ...unrelated], [r]);
  const changed = applyRelationalJoinDelta(huge, batch(huge, 'cancel-products', 1,
    [{ ...l, multiplicity: (large - 1n).toString() }], [{ ...r, multiplicity: (1n - large).toString() }])).view;
  assert.equal(relationalJoinWork(changed).strategy, 'role-ordered-inner-join');
  assert.equal(changed.relation.cardinality, large.toString(), 'oversized intermediate signed products cancel before final coefficient admission');
  oracle(changed, [{ ...l, multiplicity: large.toString() }, ...unrelated], [{ ...r, multiplicity: '1' }], 1, true, false);
} else if (mode === 'dense-and-capacity-fallback') {
  const l = row('L'), r = row('R'), unrelated = padding();
  const original = bootstrap([l, ...unrelated], [r], 0, true, { outputSupports: 1 });
  const replacement = row('new-R', 'k', 'new');
  const replaced = applyRelationalJoinDelta(original, batch(original, 'replace', 1, [], [replacement, { ...r, multiplicity: '-1' }])).view;
  assert.equal(relationalJoinWork(replaced).strategy, 'full-affected-view-recomputation'); oracle(replaced, [l, ...unrelated], [replacement], 1);
  const overflow = applyRelationalJoinDelta(original, batch(original, 'overflow', 1, [], [replacement]));
  assert.equal(overflow.status, 'retention-budget'); assert.equal(overflow.view, original); assert.equal(overflow.consumed, false);
  const anti = bootstrap([l, ...unrelated], [], 0, true, undefined, 'left-anti-join');
  const blocked = applyRelationalJoinDelta(anti, batch(anti, 'present', 1, [], [r])).view;
  assert.equal(relationalJoinWork(blocked).strategy, 'full-affected-view-recomputation'); assert.equal(blocked.relation.cardinality, String(unrelated.length));
} else if (mode === 'partial-domain-and-replay') {
  const l = row('L', 'a', 'k', '2'), r = row('R', 'k', 'b'), unrelated = padding(), original = bootstrap([l, ...unrelated], [r], 0, false);
  const change = batch(original, 'complete', 1, [], [], true), complete = applyRelationalJoinDelta(original, change).view;
  assert.equal(relationalJoinWork(complete).strategy, 'role-ordered-inner-join'); assert.equal(relationalJoinWork(complete).incrementalPairTerms, 0);
  assert.equal(describeRelationalJoin(complete).capturedDomainComplete, true); assert.equal(original.relation.cardinality, '2'); oracle(complete, [l, ...unrelated], [r], 1);
  assert.equal(applyRelationalJoinDelta(complete, change).view, complete);
  assert.throws(() => applyRelationalJoinDelta(complete, { ...change, left: { ...change.left, edits: [l] } }), /replay changed/);
  const controller = new AbortController(); controller.abort();
  assert.equal(applyRelationalJoinDelta(complete, batch(complete, 'cancelled', 2, [], []), { signal: controller.signal }).status, 'cancelled');
} else {
  const unrelated = padding(), l = row('L'), r = row('R');
  let leftCount = 1, rightCount = 1, current = bootstrap([l, ...unrelated], [r]);
  const edits = [[1, 1], [0, 1], [-1, -1], [2, -1], [-3, 2], [1, -1], [1, 0]];
  for (const [index, [dl, dr]] of edits.entries()) {
    leftCount += dl; rightCount += dr;
    assert.ok(leftCount >= 0 && rightCount >= 0);
    const next = applyRelationalJoinDelta(current, batch(current, 'revision:' + index, index + 1,
      dl ? [{ ...l, multiplicity: String(dl) }] : [], dr ? [{ ...r, multiplicity: String(dr) }] : []));
    assert.equal(next.consumed, true); current = next.view;
    oracle(current, [...(leftCount ? [{ ...l, multiplicity: String(leftCount) }] : []), ...unrelated],
      rightCount ? [{ ...r, multiplicity: String(rightCount) }] : [], index + 1);
  }
}
console.log('Sparse inner-join maintenance retains every mixed role term, exact parent identity and atomic coefficient bound.');
