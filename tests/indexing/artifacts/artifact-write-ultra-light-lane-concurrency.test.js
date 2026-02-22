#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  resolveArtifactLaneConcurrencyWithUltraLight,
  selectMicroWriteBatch,
  selectTailWorkerWriteEntry
} from '../../../src/index/build/artifacts-write.js';

const ultraOnly = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 4,
  ultraLightWrites: 10,
  lightWrites: 0,
  heavyWrites: 0,
  hostConcurrency: 16
});
assert.deepEqual(
  ultraOnly,
  { ultraLightConcurrency: 4, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected ultra-light-only queue to use full writer concurrency'
);

const ultraAndHeavy = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 8,
  ultraLightWrites: 5,
  lightWrites: 0,
  heavyWrites: 30,
  hostConcurrency: 16
});
assert.deepEqual(
  ultraAndHeavy,
  { ultraLightConcurrency: 2, lightConcurrency: 0, heavyConcurrency: 6 },
  'expected ultra-light lane to reserve dedicated slots beside heavy writes'
);

const mixedQueues = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 6,
  ultraLightWrites: 3,
  lightWrites: 12,
  heavyWrites: 12,
  hostConcurrency: 16
});
assert.deepEqual(
  mixedQueues,
  { ultraLightConcurrency: 2, lightConcurrency: 2, heavyConcurrency: 2 },
  'expected mixed writes to keep ultra-light slots while balancing light/heavy lanes'
);

const singleSlot = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 1,
  ultraLightWrites: 3,
  lightWrites: 0,
  heavyWrites: 6,
  hostConcurrency: 16
});
assert.deepEqual(
  singleSlot,
  { ultraLightConcurrency: 1, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected writeConcurrency=1 to prioritize ultra-light queue over heavy backlog'
);

const microQueue = [
  { estimatedBytes: 8 * 1024, prefetched: null, job: async () => {}, seq: 0, label: 'meta-a' },
  { estimatedBytes: 10 * 1024, prefetched: null, job: async () => {}, seq: 1, label: 'meta-b' },
  { estimatedBytes: 96 * 1024, prefetched: null, job: async () => {}, seq: 2, label: 'meta-c' }
];
const microBatch = selectMicroWriteBatch(microQueue, {
  maxEntries: 4,
  maxBytes: 40 * 1024,
  maxEntryBytes: 32 * 1024
});
assert.equal(microBatch.entries.length, 2, 'expected micro batch to coalesce queue head entries');
assert.equal(microBatch.estimatedBytes, 18 * 1024, 'expected coalesced batch byte estimate');
assert.equal(microQueue.length, 1, 'expected queue to retain non-coalesced tail entry');

const tailQueues = {
  massive: [
    { estimatedBytes: 200 * 1024 * 1024, priority: 10, seq: 5, label: 'massive-A' },
    { estimatedBytes: 120 * 1024 * 1024, priority: 11, seq: 6, label: 'massive-B' }
  ],
  heavy: [
    { estimatedBytes: 40 * 1024 * 1024, priority: 50, seq: 1, label: 'heavy-A' }
  ],
  light: [],
  ultraLight: []
};
const tailSelection = selectTailWorkerWriteEntry(tailQueues);
assert.equal(tailSelection?.laneName, 'massive', 'expected tail worker to pick highest predicted write cost');
assert.equal(tailSelection?.entry?.label, 'massive-A', 'expected deterministic tail worker selection');
assert.equal(tailQueues.massive.length, 1, 'expected selected tail entry to be removed from source lane');

console.log('artifact write ultra-light lane concurrency test passed');
