#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createCsrNeighborResolver } from '../../src/graph/neighborhood/csr.js';
import { createGraphNeighborResolver } from '../../src/graph/neighborhood/walker.js';

const ids = Array.from({ length: 16 }, (_, index) => `chunk-${String(index).padStart(2, '0')}`);
const nodes = ids.map((id, index) => ({
  id, file: `src/${index}.js`,
  out: [ids[(index + 1) % ids.length], ids[(index + 3) % ids.length], ids[(index + 3) % ids.length]],
  in: [ids[(index + ids.length - 1) % ids.length], ids[(index + ids.length - 3) % ids.length]]
}));
const graphRelations = {
  version: 1,
  callGraph: { nodeCount: nodes.length, edgeCount: nodes.length * 3, nodes },
  usageGraph: { nodeCount: nodes.length, edgeCount: nodes.length * 3, nodes },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};
const graphIndex = buildGraphIndex({ graphRelations, includeCsr: true });
const materialized = createCsrNeighborResolver({ graphIndex });
const iterable = createCsrNeighborResolver({ graphIndex, iterable: true });
for (const graph of ['callGraph', 'usageGraph']) {
  for (const direction of ['out', 'in', 'both']) {
    for (const id of ids) {
      assert.deepEqual([...iterable(graph, id, direction)], materialized(graph, id, direction));
    }
  }
}
assert.equal(iterable('missingGraph', ids[0], 'out'), null);
assert.deepEqual([...iterable('callGraph', 'missing', 'both')], []);
assert.ok(graphIndex._csrReverseByGraph.callGraph, 'incoming traversal retains the shared reverse CSR');

// Normalization can change order and identity, so it remains eager and identical.
for (const direction of ['out', 'in', 'both']) {
  const expectedCalls = [];
  const actualCalls = [];
  const normalize = (calls) => (id) => {
    calls.push(id);
    return Number(id.slice(-2)) % 2 ? 'odd' : 'even';
  };
  const expected = materialized('callGraph', ids[0], direction, normalize(expectedCalls));
  const actual = iterable('callGraph', ids[0], direction, normalize(actualCalls));
  assert.deepEqual(actualCalls, expectedCalls, 'normalizer evaluation remains eager and in the same order');
  assert.deepEqual([...actual], expected);
}

const fanoutIds = ['seed', ...Array.from({ length: 128 }, (_, index) => `target-${String(index).padStart(3, '0')}`)];
let reads = 0;
const observedIds = new Proxy(fanoutIds, {
  get(target, key, receiver) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) reads += 1;
    return Reflect.get(target, key, receiver);
  }
});
const fanoutIndex = {
  graphRelationsCsr: { callGraph: {
    ids: observedIds,
    offsets: Uint32Array.from([0, 128, ...Array(128).fill(128)]),
    edges: Uint32Array.from(Array.from({ length: 128 }, (_, index) => index + 1))
  } },
  callGraphIds: { idToIndex: new Map([['seed', 0]]) }
};
const baseline = createCsrNeighborResolver({ graphIndex: fanoutIndex });
assert.equal(baseline('callGraph', 'seed', 'out').length, 128);
assert.equal(reads, 128);
reads = 0;
const resolveWalk = createGraphNeighborResolver({ graphIndex: fanoutIndex, iterableCsr: true });
const borrowed = resolveWalk(new Map(), 'seed', 'out', null, null, 'callGraph');
assert.equal(reads, 0, 'raw CSR resolution must not first materialize the neighbor array');
const prefix = [];
for (const id of borrowed) {
  prefix.push(id);
  if (prefix.length === 3) break;
}
assert.deepEqual(prefix, fanoutIds.slice(1, 4));
assert.equal(reads, 3, 'a prefix consumer reads only its admitted CSR span');

// Actual neighborhood output, paths and truncation match the existing adjacency route.
const semantic = (result) => {
  const { stats: _stats, ...rest } = result;
  return rest;
};
for (const direction of ['out', 'in', 'both']) {
  for (const caps of [
    { maxNodes: 30, maxEdges: 50, maxFanoutPerNode: 25, maxWorkUnits: 1000, maxPaths: 25 },
    { maxNodes: 4, maxEdges: 3, maxFanoutPerNode: 1, maxWorkUnits: 20, maxPaths: 2 }
  ]) {
    const request = { seed: { type: 'chunk', chunkUid: ids[0] }, direction, depth: 3, includePaths: true, caps };
    assert.deepEqual(
      semantic(buildGraphNeighborhood({ ...request, graphIndex })),
      semantic(buildGraphNeighborhood({ ...request, graphRelations }))
    );
  }
}
console.log('CSR neighbor iteration passed: ordered/deduped directions, normalization, borrowed-prefix reads, actual neighborhood paths/caps');
