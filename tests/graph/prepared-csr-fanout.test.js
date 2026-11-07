import assert from 'node:assert/strict';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createDirectedGraphNeighborResolver } from '../../src/graph/neighborhood/walker.js';
const ids = Array.from({ length: 1001 }, (_, id) => `n${String(id).padStart(4, '0')}`);
const nodes = ids.map((id, index) => ({ id, out: index ? [] : ids.slice(1), in: index ? [ids[0]] : [] }));
const graph = { version: 1, callGraph: { nodes }, usageGraph: { nodes: [] }, importGraph: { nodes: [] } };
const ordinary = buildGraphIndex({ graphRelations: graph });
const derived = buildGraphIndex({ graphRelations: graph, includeCsr: true });
assert.equal(derived.callGraphAdjacency, null);
assert.equal(derived.usageGraphAdjacency, null);
assert.equal(derived.importGraphAdjacency, null);
const withoutOutgoing = { ...graph, callGraph: { nodes: nodes.map(node => ({ id: node.id,
  get out() { throw new Error('admitted CSR must not rebuild ordinary adjacency'); } })) } };
const supplied = buildGraphIndex({ graphRelations: withoutOutgoing, graphRelationsCsr: derived.graphRelationsCsr, includeCsr: true });
assert.equal(supplied.graphRelationsCsr.callGraph, derived.graphRelationsCsr.callGraph);
const resolve = createDirectedGraphNeighborResolver({ graphIndex: supplied, iterableCsr: true });
let observed = null;
const prefix = [...resolve(supplied.callGraphIndex, ids[0], 'out', null, null, 'callGraph',
  { limit: 1, onCount: count => { observed = count; } })];
assert.equal(observed, 1000);
assert.deepEqual(prefix, [{ neighborId: ids[1], fromId: ids[0], toId: ids[1] }]);
for (const direction of ['out', 'in', 'both']) {
  const input = { seed: { type: 'chunk', chunkUid: ids[direction === 'in' ? 1 : 0] }, depth: 1,
    direction, caps: { maxFanoutPerNode: 3 }, includePaths: true };
  const baseline = buildGraphNeighborhood({ ...input, graphIndex: ordinary });
  const compact = buildGraphNeighborhood({ ...input, graphIndex: derived });
  for (const field of ['nodes', 'edges', 'paths', 'truncation', 'warnings']) assert.deepEqual(compact[field], baseline[field]);
}
const invalid = { ...derived.graphRelationsCsr, callGraph: { ...derived.graphRelationsCsr.callGraph,
  offsets: new Uint32Array([0]) } };
const fallback = buildGraphIndex({ graphRelations: graph, graphRelationsCsr: invalid, includeCsr: true });
assert.equal(fallback.graphRelationsCsr.callGraph.edges.length, 1000, 'malformed direct CSR derives a complete family');
console.log('Admitted CSR avoids retained ordinary rows and counts discarded fanout without descriptors.');
