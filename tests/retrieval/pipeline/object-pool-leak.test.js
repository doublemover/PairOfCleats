#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCandidatePool } from '../../../src/retrieval/pipeline/candidate-pool.js';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';

process.env.PAIROFCLEATS_TESTING = '1';

const candidatePool = createCandidatePool({ maxSets: 1, maxEntries: 2 });
const oversized = candidatePool.acquire();
oversized.add(1);
oversized.add(2);
oversized.add(3);
candidatePool.release(oversized);
assert.ok(candidatePool.stats.drops > 0, 'expected candidate pool to drop oversized sets');

const reused = candidatePool.acquire();
assert.equal(reused.size, 0, 'expected candidate pool to clear reused sets');
candidatePool.release(reused);

const scoreBufferPool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 2 });
const buffer = scoreBufferPool.acquire({
  fields: ['idx', 'score'],
  numericFields: ['idx', 'score'],
  capacity: 5
});
buffer.push({ idx: 1, score: 0.1 });
scoreBufferPool.release(buffer);
assert.ok(scoreBufferPool.stats.drops > 0, 'expected score buffer pool to drop oversized buffers');

console.log('object pool leak test passed');
