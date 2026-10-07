#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphContextPack } from '../../src/graph/context-pack.js';
import { validateGraphContextPack } from '../../src/contracts/validators/analysis.js';
import { chunkCallGraphRelations } from './helpers/graph-fixtures.js';

const symbolEdges = [
  {
    from: { chunkUid: 'chunk-a' },
    to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym-a' }, candidates: [] },
    type: 'symbol',
    confidence: 0.5
  }
];

const chunkOut = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  symbolEdges,
  edgeFilters: { graphs: ['symbolEdges'] },
  direction: 'out',
  depth: 1
});
assert(chunkOut.edges.length === 1, 'expected chunk->symbol edge on out');

const chunkIn = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  symbolEdges,
  edgeFilters: { graphs: ['symbolEdges'] },
  direction: 'in',
  depth: 1
});
assert(chunkIn.edges.length === 0, 'expected no symbol edge on chunk in-direction');

const symbolIn = buildGraphNeighborhood({
  seed: { type: 'symbol', symbolId: 'sym-a' },
  symbolEdges,
  edgeFilters: { graphs: ['symbolEdges'] },
  direction: 'in',
  depth: 1
});
assert(symbolIn.edges.length === 1, 'expected symbol to receive edge on in-direction');

const symbolOut = buildGraphNeighborhood({
  seed: { type: 'symbol', symbolId: 'sym-a' },
  symbolEdges,
  edgeFilters: { graphs: ['symbolEdges'] },
  direction: 'out',
  depth: 1
});
assert(symbolOut.edges.length === 0, 'expected no edges on symbol out-direction');

const chunkRef = { type: 'chunk', chunkUid: 'chunk-a' };
const symbolRef = { type: 'symbol', symbolId: 'sym-a' };
for (const [seed, direction, target] of [
  [chunkRef, 'out', symbolRef],
  [chunkRef, 'both', symbolRef],
  [symbolRef, 'in', chunkRef],
  [symbolRef, 'both', chunkRef]
]) {
  for (const includePaths of [false, true]) {
    const pack = buildGraphContextPack({
      seed,
      symbolEdges,
      edgeFilters: { graphs: ['symbolEdges'] },
      direction,
      depth: 1,
      includePaths,
      indexCompatKey: 'symbol-witness-test'
    });
    assert.deepStrictEqual(validateGraphContextPack(pack), { ok: true, errors: [] });
    assert(pack.nodes.some((node) => JSON.stringify(node.ref) === JSON.stringify(target)));
    assert.strictEqual(pack.edges[0].to.status, 'resolved', 'graph edge keeps its reference envelope');
    if (includePaths) {
      assert.deepStrictEqual(pack.paths[0].nodes, [seed, target]);
      assert.deepStrictEqual(pack.paths[0].edges, [{ from: chunkRef, to: symbolRef, edgeType: 'symbol' }]);
    } else {
      assert.strictEqual(pack.paths, null);
    }
  }
}

const mixed = buildGraphContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-b' },
  graphRelations: chunkCallGraphRelations(),
  symbolEdges,
  direction: 'both',
  depth: 2,
  includePaths: true,
  indexCompatKey: 'mixed-witness-test'
});
assert.deepStrictEqual(validateGraphContextPack(mixed), { ok: true, errors: [] });
const mixedPath = mixed.paths.find((entry) => entry.to.symbolId === 'sym-a');
assert.deepStrictEqual(mixedPath.nodes, [{ type: 'chunk', chunkUid: 'chunk-b' }, chunkRef, symbolRef]);
assert.deepStrictEqual(mixedPath.edges.map((edge) => edge.edgeType), ['call', 'symbol']);

const unresolved = buildGraphContextPack({
  seed: chunkRef,
  symbolEdges: [{ ...symbolEdges[0], to: { v: 1, status: 'unresolved', resolved: null, candidates: [] } }],
  direction: 'out',
  depth: 1,
  includePaths: true,
  indexCompatKey: 'unresolved-witness-test'
});
assert.deepStrictEqual(validateGraphContextPack(unresolved), { ok: true, errors: [] });
assert.strictEqual(unresolved.edges.length, 1, 'unresolved edge remains visible');
assert.strictEqual(unresolved.nodes.length, 1, 'unresolved edge does not invent a node');
assert.deepStrictEqual(unresolved.paths, [], 'unresolved edge does not invent a witness');

console.log('graph symbol direction test passed');
