#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildStage1BatchExecutionPlan,
  resolveStage1BatchEntryMeta,
  shouldWaitForOrderedDispatchCapacity
} from '../../../src/index/build/indexer/steps/process-files/entry-batch-plan.js';

ensureTestingEnv(process.env);

const root = path.join(path.sep, 'repo-root');
const entries = [
  {
    abs: path.join(root, 'src', 'z.js'),
    orderIndex: 9,
    fileIndex: 91,
    ext: '.js'
  },
  {
    rel: 'src/a.js',
    canonicalOrderIndex: 3,
    fileIndex: 11,
    ext: '.js'
  },
  {
    abs: path.join(root, 'src', 'm.js'),
    orderIndex: 12,
    ext: '.js'
  }
];

const lifecycleByOrderIndex = new Map([
  [9, { enqueuedAtMs: 77, file: null, fileIndex: null, shardId: null }]
]);
const ensureLifecycleRecord = ({ orderIndex, file, fileIndex, shardId }) => {
  const key = Number.isFinite(orderIndex) ? Math.floor(orderIndex) : -1;
  const existing = lifecycleByOrderIndex.get(key) || {
    enqueuedAtMs: null,
    file: null,
    fileIndex: null,
    shardId: null
  };
  if (!existing.file && file) existing.file = file;
  if (!Number.isFinite(existing.fileIndex) && Number.isFinite(fileIndex)) {
    existing.fileIndex = Math.floor(fileIndex);
  }
  if (!existing.shardId && shardId) existing.shardId = shardId;
  lifecycleByOrderIndex.set(key, existing);
  return existing;
};

let nowTick = 1000;
const plan = buildStage1BatchExecutionPlan({
  entries,
  root,
  shardId: 'shard-7',
  ensureLifecycleRecord,
  nowMs: () => {
    nowTick += 10;
    return nowTick;
  }
});

assert.deepEqual(
  plan.metadataByIndex.map((entryMeta) => ({
    orderIndex: entryMeta.orderIndex,
    rel: entryMeta.rel,
    fileIndex: entryMeta.fileIndex
  })),
  [
    { orderIndex: 3, rel: 'src/a.js', fileIndex: 11 },
    { orderIndex: 9, rel: 'src/z.js', fileIndex: 91 },
    { orderIndex: 12, rel: 'src/m.js', fileIndex: 3 }
  ],
  'expected ordered metadata to precompute deterministic orderIndex/rel/fileIndex'
);
assert.equal(
  lifecycleByOrderIndex.get(3)?.enqueuedAtMs,
  1010,
  'expected new lifecycle rows to capture enqueued time during batch planning'
);
assert.equal(
  lifecycleByOrderIndex.get(9)?.enqueuedAtMs,
  77,
  'expected pre-existing lifecycle enqueued timestamps to stay untouched'
);
assert.equal(
  lifecycleByOrderIndex.get(12)?.enqueuedAtMs,
  1020,
  'expected later lifecycle rows to preserve deterministic enqueue ordering'
);

const precomputedMeta = resolveStage1BatchEntryMeta({
  metadataByIndex: plan.metadataByIndex,
  entryIndex: 1,
  entry: null,
  root,
  shardId: 'ignored'
});
assert.equal(precomputedMeta.orderIndex, 9, 'expected precomputed metadata lookup by queue index');
assert.equal(precomputedMeta.rel, 'src/z.js', 'expected precomputed rel lookup by queue index');

const fallbackMeta = resolveStage1BatchEntryMeta({
  metadataByIndex: plan.metadataByIndex,
  entryIndex: 99,
  entry: { abs: path.join(root, 'src', 'fallback.js') },
  root,
  shardId: 'fallback-shard'
});
assert.equal(fallbackMeta.orderIndex, 99, 'expected fallback order index from queue index when metadata misses');
assert.equal(fallbackMeta.fileIndex, 100, 'expected fallback file index from queue index when metadata misses');
assert.equal(fallbackMeta.rel, 'src/fallback.js', 'expected fallback rel normalization for cache-miss metadata');
assert.equal(fallbackMeta.shardId, 'fallback-shard', 'expected fallback shard id passthrough');

assert.equal(
  shouldWaitForOrderedDispatchCapacity({
    entryIndex: 0,
    orderIndex: 14,
    nextOrderedIndex: 5,
    bypassWindow: 4
  }),
  true,
  'expected dispatch capacity waits when probe index is outside bypass window'
);
assert.equal(
  shouldWaitForOrderedDispatchCapacity({
    entryIndex: 4,
    orderIndex: 9,
    nextOrderedIndex: 5,
    bypassWindow: 4
  }),
  false,
  'expected no wait when probe index is within bypass window'
);
assert.equal(
  shouldWaitForOrderedDispatchCapacity({
    entryIndex: 5,
    orderIndex: 99,
    nextOrderedIndex: 0,
    bypassWindow: 4
  }),
  false,
  'expected non-probe dispatch indexes to skip capacity waits for throughput'
);
assert.equal(
  shouldWaitForOrderedDispatchCapacity({
    entryIndex: 0,
    orderIndex: null,
    nextOrderedIndex: null,
    bypassWindow: 4
  }),
  true,
  'expected conservative wait when probe index lacks deterministic order pointers'
);

console.log('process-files entry batch plan helper test passed');
