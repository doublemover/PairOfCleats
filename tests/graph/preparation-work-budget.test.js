import assert from 'node:assert/strict';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createDirectedGraphNeighborResolver } from '../../src/graph/neighborhood/walker.js';
import { createWorkBudget } from '../../src/graph/work-budget.js';
import { createFanoutPrefixFixture, projectFanoutResult } from './helpers/fanout-prefix-fixture.js';

// A prepared large row must not spend the entire fanout before its first checkpoint.
for (const csr of [true, false]) {
  for (const cap of [null, 3]) {
    const fixture = createFanoutPrefixFixture({ csr, cap });
    fixture.request.caps.maxWorkUnits = 1;
    const output = buildGraphNeighborhood(fixture.request);
    assert.equal(fixture.getEvidenceLookups(), 0, 'exhaustion precedes evidence and endpoint construction');
    assert.equal(output.edges.length, 0);
    assert.equal(output.stats.counts.workUnitsUsed, 1);
    assert.ok(output.truncation.some(entry => entry.cap === 'maxWorkUnits'));
  }
}
const descriptors = createFanoutPrefixFixture();
const directed = createDirectedGraphNeighborResolver({ graphIndex: descriptors.request.graphIndex, iterableCsr: true });
let attempted = 0;
const none = [...directed(descriptors.request.graphIndex.callGraphIndex, 'chunk-000', 'out', null, null,
  'callGraph', { admit: () => { attempted++; return false; } })];
assert.deepEqual(none, [], 'descriptor generator stops at its pre-construction admission checkpoint');
assert.equal(attempted, 1);
const partial = createFanoutPrefixFixture({ cap: null });
partial.request.caps.maxWorkUnits = 2;
const prefix = buildGraphNeighborhood(partial.request);
assert.equal(prefix.edges.length, 1, 'already admitted candidates survive later preparation exhaustion');
assert.equal(partial.getEvidenceLookups(), 1);

const timed = createFanoutPrefixFixture({ cap: null });
let clock = 0;
timed.request.workBudget = createWorkBudget({ maxWallClockMs: 1, checkEvery: 1, now: () => clock++ });
const deadline = buildGraphNeighborhood(timed.request);
assert.equal(timed.getEvidenceLookups(), 0);
assert.ok(deadline.truncation.some(entry => entry.cap === 'maxWallClockMs'));

// Borrow the actual prepared symbol-entry owner, instrumenting its candidate row.
for (const units of [1, 2, 3]) {
  const fixture = createFanoutPrefixFixture({ cap: null });
  fixture.request.edgeFilters = { graphs: ['symbolEdges'] };
  fixture.request.caps.maxCandidates = null;
  fixture.request.caps.maxWorkUnits = units;
  const entry = fixture.request.graphIndex.symbolIndex.byChunk.get('chunk-000')[0];
  let candidateReads = 0;
  entry.toRef = { ...entry.toRef, candidates: new Proxy(new Array(100000).fill({ symbolId: 'expensive-candidate' }), {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) candidateReads++;
      return Reflect.get(target, key, receiver);
    }
  }) };
  const result = buildGraphNeighborhood(fixture.request);
  assert.equal(candidateReads, 0, 'tiny budgets stop before materializing a large candidate projection');
  assert.equal(result.edges.length, 0);
  assert.ok(result.stats.counts.workUnitsUsed <= units);
}
for (const direction of ['out', 'in', 'both']) {
  const compact = createFanoutPrefixFixture({ direction, cap: null });
  const ordinary = createFanoutPrefixFixture({ direction, cap: null, csr: false });
  for (const fixture of [compact, ordinary]) fixture.request.caps.maxWorkUnits = 10000;
  assert.deepEqual(projectFanoutResult(buildGraphNeighborhood(compact.request)),
    projectFanoutResult(buildGraphNeighborhood(ordinary.request)), 'sufficient-budget exact prepared/legacy parity');
}
console.log('Graph preparation budget guards evidence, descriptors and large symbol projections before work.');
