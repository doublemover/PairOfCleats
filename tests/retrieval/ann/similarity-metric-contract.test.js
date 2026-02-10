#!/usr/bin/env node
import assert from 'node:assert/strict';
import { distanceToSimilarity } from '../../../src/shared/ann-similarity.js';
import { rankHnswIndex } from '../../../src/shared/hnsw.js';

assert.equal(distanceToSimilarity(0.25, 'cosine'), 0.75);
assert.equal(distanceToSimilarity(4, 'l2'), -4);
assert.equal(distanceToSimilarity(1.5, 'ip'), -1.5);
assert.equal(distanceToSimilarity(Number.NaN, 'l2'), null);

const fakeIndex = {
  getCurrentCount: () => 2,
  searchKnn: () => ({
    neighbors: [7, 3],
    distances: [0.2, 0.8]
  })
};

const cosineHits = rankHnswIndex({ index: fakeIndex, space: 'cosine' }, [0.1], 2, null);
assert.deepEqual(cosineHits, [{ idx: 7, sim: 0.8 }, { idx: 3, sim: 0.19999999999999996 }]);

const ipHits = rankHnswIndex({ index: fakeIndex, space: 'ip' }, [0.1], 2, null);
assert.deepEqual(ipHits, [{ idx: 7, sim: -0.2 }, { idx: 3, sim: -0.8 }]);

console.log('similarity metric contract test passed');
