#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createCsrNeighborResolver } from '../../src/graph/neighborhood/csr.js';

const graphIndex = {
  graphRelationsCsr: {
    callGraph: {
      ids: ['chunk-a', 'chunk-b', 'chunk-c'],
      offsets: Uint32Array.from([0, 3, 4, 4]),
      edges: Uint32Array.from([1, 2, 2, 0])
    }
  },
  callGraphIds: {
    ids: ['chunk-a', 'chunk-b', 'chunk-c'],
    idToIndex: new Map([
      ['chunk-a', 0],
      ['chunk-b', 1],
      ['chunk-c', 2]
    ])
  }
};

const resolve = createCsrNeighborResolver({ graphIndex });

assert.deepEqual(
  resolve('callGraph', 'chunk-a', 'out'),
  ['chunk-b', 'chunk-c'],
  'expected CSR out-neighbors to be deduped and sorted'
);
assert.deepEqual(
  resolve('callGraph', 'chunk-a', 'in'),
  ['chunk-b'],
  'expected CSR reverse-neighbors to be derived from reverse CSR'
);
assert.deepEqual(
  resolve('callGraph', 'chunk-a', 'both'),
  ['chunk-b', 'chunk-c'],
  'expected combined CSR neighbors to preserve deterministic ordering'
);
assert.ok(graphIndex._csrReverseByGraph?.callGraph, 'expected reverse CSR cache to be memoized by graph');

console.log('graph CSR neighbor resolver test passed');
