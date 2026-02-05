#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';

const symbolEdges = [
  {
    from: { chunkUid: 'chunk-a' },
    to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym-a' }, candidates: [] },
    type: 'symbol',
    confidence: 0.2
  },
  {
    from: { chunkUid: 'chunk-a' },
    to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym-a' }, candidates: [] },
    type: 'symbol',
    confidence: 0.9,
    reason: 'better'
  }
];

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  symbolEdges,
  edgeFilters: { graphs: ['symbolEdges'] },
  depth: 1
});

assert.strictEqual(result.edges.length, 1, 'expected duplicate edges to be deduped');
assert.strictEqual(result.edges[0].confidence, 0.9, 'expected higher confidence edge to win');

console.log('graph edge dedupe policy test passed');
