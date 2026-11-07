import assert from 'node:assert/strict';
import { bootstrapAdjacencyView, readAdjacencyViewInput } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapRelationalJoin, applyRelationalJoinDelta, describeRelationalJoin, relationalJoinWork } from '../../../src/index/semantic/views/relational-join.js';
import { openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/relational-join/')[1];
assert.ok(['simultaneous-join-and-provenance', 'anti-join-zero-crossings', 'partial-domain-observations',
  'atomic-cohort-and-replay', 'bounded-and-cancelled-cohorts', 'independent-bag-oracle'].includes(mode));
const world = revision => ({ generation: { baseBuildId: 'join-' + revision, semanticRevision: 0 }, repositoryNamespace: 'finite-relation-fixture', contextKey: 'context' });
const inputDefinition = side => ({ viewId: side, producerId: 'fixture', producerEpoch: 'epoch', ruleVersion: '1',
  configHash: 'a'.repeat(64), domainId: side, algebra: 'signed-occurrence-bag-v1' });
const definition = operator => ({ schemaVersion: 1, id: 'composed', operator, ruleVersion: '1', configHash: 'b'.repeat(64), domainId: 'joined-domain', leftDomainId: 'left', rightDomainId: 'right' });
const row = (id, from = 'a', to = 'k', multiplicity = '1') => ({ occurrenceId: 'occurrence:' + id, supportId: id, from, to, multiplicity, sourceRef: 'source:' + id });
const bootstrap = (operator, leftRows = [], rightRows = [], { leftComplete = true, rightComplete = true, limits } = {}) => {
  const left = bootstrapAdjacencyView({ definition: inputDefinition('left'), world: world(0), rows: leftRows, complete: leftComplete });
  const right = bootstrapAdjacencyView({ definition: inputDefinition('right'), world: world(0), rows: rightRows, complete: rightComplete });
  return { left, right, view: bootstrapRelationalJoin({ definition: definition(operator), left, right, ...(limits ? { limits } : {}) }) };
};
const batch = (view, id, revision, leftEdits = [], rightEdits = [], { leftComplete = true, rightComplete = true } = {}) => {
  const report = describeRelationalJoin(view);
  const side = (name, edits, capturedDomainComplete) => ({ batchId: id + ':' + name, definition: inputDefinition(name),
    fromWorld: report.world, toWorld: world(revision), baseRoot: report.inputRoots[name], edits, capturedDomainComplete });
  return { batchId: id, expectedRootId: view.rootId, left: side('left', leftEdits, leftComplete), right: side('right', rightEdits, rightComplete) };
};
const bag = view => {
  const cursor = openOccurrenceCursor({ relation: view.relation });
  try {
    const page = cursor.next({ limit: 256, maxBytes: 262144 }); assert.equal(page.state, 'exhausted');
    return page.items.map(item => JSON.stringify([item.tuple.from, item.tuple.to])).sort();
  } finally { cursor.close(); }
};
if (mode === 'simultaneous-join-and-provenance') {
  const base = bootstrap('inner-join'), left = row('l', 'a', 'k', '2'), right = row('r', 'k', 'b', '3');
  const next = applyRelationalJoinDelta(base.view, batch(base.view, 'both', 1, [left], [right]));
  assert.equal(next.consumed, true); assert.equal(next.view.relation.cardinality, '6'); assert.equal(base.view.relation.cardinality, '0');
  assert.equal(describeRelationalJoin(next.view).rows.length, 1, 'one original parent pair carries its exact coefficient without expansion');
  const output = describeRelationalJoin(next.view).rows[0]; assert.equal(output.multiplicity, '6');
  assert.deepEqual(output.parents, { left: { occurrenceId: left.occurrenceId, supportId: left.supportId, sourceRef: left.sourceRef },
    right: { occurrenceId: right.occurrenceId, supportId: right.supportId, sourceRef: right.sourceRef } });
  const changed = applyRelationalJoinDelta(next.view, batch(next.view, 'another-support', 2, [], [row('r2', 'k', 'b')]));
  assert.equal(changed.view.relation.cardinality, '8'); assert.equal(describeRelationalJoin(changed.view).rows.length, 2);
  assert.equal(describeRelationalJoin(changed.view).rows.find(item => item.parents.right.supportId === 'r').supportId, output.supportId);
  assert.match(relationalJoinWork(changed.view).strategy, /full-affected/);
  assert.equal(next.view.publication, 'private-unpublished'); assert.equal(next.view.semanticClosure, 'not-implied');
} else if (mode === 'anti-join-zero-crossings') {
  const l = row('l', 'a', 'k', '2'), r1 = row('r1', 'k', 'b'), r2 = row('r2', 'k', 'c');
  let current = bootstrap('left-anti-join', [l], [r1, r2]).view;
  assert.equal(current.relation.cardinality, '0');
  current = applyRelationalJoinDelta(current, batch(current, 'two-to-one', 1, [], [{ ...r1, multiplicity: '-1' }])).view;
  assert.equal(current.relation.cardinality, '0', 'one remaining right support still blocks every left copy');
  current = applyRelationalJoinDelta(current, batch(current, 'one-to-zero', 2, [], [{ ...r2, multiplicity: '-1' }])).view;
  assert.equal(current.relation.cardinality, '2'); const emptyRight = current;
  current = applyRelationalJoinDelta(current, batch(current, 'zero-to-one', 3, [], [r1])).view;
  assert.equal(current.relation.cardinality, '0'); assert.equal(emptyRight.relation.cardinality, '2');
} else if (mode === 'partial-domain-observations') {
  const l = row('l'), partial = bootstrap('left-anti-join', [l], [], { rightComplete: false });
  assert.equal(partial.view.relation.cardinality, '0'); assert.equal(describeRelationalJoin(partial.view).unresolvedLeftSupports, 1);
  assert.equal(describeRelationalJoin(partial.view).capturedDomainComplete, false);
  const closed = applyRelationalJoinDelta(partial.view, batch(partial.view, 'close-right', 1));
  assert.equal(closed.view.relation.cardinality, '1'); assert.equal(describeRelationalJoin(closed.view).capturedDomainComplete, true);
  const join = bootstrap('inner-join', [l], [row('r', 'k', 'b')], { rightComplete: false });
  assert.equal(join.view.relation.cardinality, '1', 'captured positive pairs remain available with an incomplete domain');
  assert.equal(describeRelationalJoin(join.view).capturedDomainComplete, false);
  const unknownLeft = bootstrap('left-anti-join', [l], [], { leftComplete: false });
  assert.equal(unknownLeft.view.relation.cardinality, '1'); assert.equal(describeRelationalJoin(unknownLeft.view).capturedDomainComplete, false);
} else if (mode === 'atomic-cohort-and-replay') {
  const base = bootstrap('inner-join'), original = batch(base.view, 'atomic', 1, [row('l')], [row('r', 'k', 'b')]);
  const invalid = structuredClone(original); invalid.right.edits[0].multiplicity = '-1';
  assert.throws(() => applyRelationalJoinDelta(base.view, invalid), /negative accumulated/);
  assert.equal(base.view.relation.cardinality, '0'); assert.equal(readAdjacencyViewInput(base.left).rows.length, 0);
  const next = applyRelationalJoinDelta(base.view, original); assert.equal(next.view.relation.cardinality, '1');
  assert.equal(applyRelationalJoinDelta(next.view, original).status, 'replayed');
  assert.throws(() => applyRelationalJoinDelta(next.view, { ...original, right: { ...original.right, edits: [] } }), /replay changed/);
  assert.throws(() => applyRelationalJoinDelta(next.view, { ...original, batchId: 'stale' }), /wrong base/);
  const mixed = batch(next.view, 'mixed', 2); mixed.right.toWorld = world(3);
  assert.throws(() => applyRelationalJoinDelta(next.view, mixed), /mixed destination/);
  const wrong = batch(next.view, 'wrong-definition', 2); wrong.right.definition.ruleVersion = '2';
  assert.throws(() => applyRelationalJoinDelta(next.view, wrong), /rebuild required/);
  assert.throws(() => describeRelationalJoin({ ...next.view }), /Original/);
  let reads = 0;
  assert.throws(() => bootstrapRelationalJoin({ left: base.left, right: base.right, get definition() { reads++; return definition('inner-join'); } })); assert.equal(reads, 0);
  const proxyDefinition = new Proxy(definition('inner-join'), { getPrototypeOf() { reads++; throw new Error('definition proxy trap must not run'); } });
  assert.throws(() => bootstrapRelationalJoin({ left: base.left, right: base.right, definition: proxyDefinition })); assert.equal(reads, 0);
  const decorated = batch(next.view, 'hidden', 2); Object.defineProperty(decorated.left.edits, 'hidden', { value: 1 });
  assert.throws(() => applyRelationalJoinDelta(next.view, decorated), /decorations/);
  const mutable = batch(base.view, 'capture', 1, [row('captured-l')], [row('captured-r', 'k', 'b')]);
  const captured = applyRelationalJoinDelta(base.view, mutable, { get signal() {
    mutable.left.edits[0].from = 'rewritten'; mutable.right.toWorld = world(99); return null;
  } });
  assert.deepEqual(bag(captured.view), [JSON.stringify(['a', 'b'])]);
  assert.deepEqual(describeRelationalJoin(captured.view).world, world(1));
} else if (mode === 'bounded-and-cancelled-cohorts') {
  const l = row('l'), r = row('r', 'k', 'b'), base = bootstrap('inner-join', [l], [r], { limits: { outputSupports: 1 } });
  const grows = batch(base.view, 'bounded', 1, [], [row('r2', 'k', 'c')]);
  const rejected = applyRelationalJoinDelta(base.view, grows);
  assert.equal(rejected.status, 'retention-budget'); assert.equal(rejected.limit, 'outputSupports'); assert.equal(rejected.view, base.view);
  assert.equal(rejected.consumed, false); assert.equal(base.view.relation.cardinality, '1');
  const replacement = batch(base.view, 'bounded', 1, [], [{ ...r, multiplicity: '-1' }, row('r2', 'k', 'c')]);
  assert.equal(applyRelationalJoinDelta(base.view, replacement).consumed, true, 'refusal does not consume its outer or inner ledger');
  const controller = new AbortController(); controller.abort(null);
  assert.equal(applyRelationalJoinDelta(base.view, grows, { signal: controller.signal }).status, 'cancelled');
  assert.throws(() => bootstrapRelationalJoin({ definition: definition('inner-join'), left: base.left, right: base.right }, { signal: controller.signal }),
    error => error.name === 'AbortError' && error.cause === null);
  const huge = bootstrap('inner-join', [row('large', 'a', 'k', '9007199254740993')], [row('factor', 'k', 'b', '3')]);
  assert.equal(huge.view.relation.cardinality, '27021597764222979');
  assert.throws(() => bootstrap('inner-join', [row('overflow-l', 'a', 'k', '9'.repeat(128))], [row('overflow-r', 'k', 'b', '2')]),
    { code: 'ERR_RELATIONAL_JOIN_BUDGET', limit: 'coefficientDigits' });
} else {
  // Independent tiny occurrence expansion, with no candidate row/arrangement
  // helper. Equality retains duplicate copies, rather than checking set members.
  const left = [row('l1', 'a', 'k', '2'), row('l2', 'z', 'm')], right = [row('r1', 'k', 'b'), row('r2', 'm', 'c', '2')];
  const expand = rows => rows.flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => [row.from, row.to]));
  for (const operator of ['inner-join', 'left-anti-join']) for (let mask = 0; mask < 16; mask++) {
    const l = left.filter((_, index) => mask & (1 << index)), r = right.filter((_, index) => mask & (1 << (index + 2)));
    const expected = [];
    for (const a of expand(l)) {
      if (operator === 'inner-join') for (const b of expand(r)) { if (a[1] === b[0]) expected.push(JSON.stringify([a[0], b[1]])); }
      else if (!expand(r).some(b => a[1] === b[0])) expected.push(JSON.stringify(a));
    }
    const cold = bootstrap(operator, l, r), empty = bootstrap(operator), next = applyRelationalJoinDelta(empty.view, batch(empty.view, 'all-inputs', 1, l, r));
    assert.deepEqual(bag(cold.view), expected.sort(), operator + ':' + mask); assert.deepEqual(bag(next.view), expected.sort());
    const rebuilt = bootstrapRelationalJoin({ definition: definition(operator),
      left: bootstrapAdjacencyView({ definition: inputDefinition('left'), world: world(1), rows: l, complete: true }),
      right: bootstrapAdjacencyView({ definition: inputDefinition('right'), world: world(1), rows: r, complete: true }) });
    assert.equal(next.view.relation.rootId, rebuilt.relation.rootId);
  }
}
console.log('Finite joined cohorts retain exact parent multiplicity and qualified anti-join absence.');
