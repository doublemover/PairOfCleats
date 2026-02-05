#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

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

console.log('graph symbol direction test passed');
