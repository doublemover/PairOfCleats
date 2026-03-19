#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createQueuedArtifactWritePlanner,
  scheduleWrites,
  splitWriteLanes
} from '../../../src/index/build/artifacts/write-queue.js';

const ordered = scheduleWrites([
  { label: 'debug.json', priority: 0, seq: 2 },
  { label: 'metrics.json', priority: 0, seq: 1 },
  { label: 'other.json', priority: 5, estimatedBytes: 4096, seq: 3 }
]);
assert.deepEqual(
  ordered.map((entry) => entry.label),
  ['metrics.json', 'other.json', 'debug.json'],
  'expected validation-critical artifacts to outrank optional writes while preserving sequence ties'
);

const lanes = splitWriteLanes([
  { label: 'tiny.json', estimatedBytes: 2 * 1024, seq: 0 },
  { label: 'report.json', estimatedBytes: 2 * 1024 * 1024, seq: 1 },
  { label: 'field_tokens.parts', estimatedBytes: 2 * 1024, seq: 2 },
  { label: 'chunk_meta.binary-columnar.bundle', estimatedBytes: 300 * 1024 * 1024, seq: 3 }
], {
  forcedHeavyWritePatterns: [/field_tokens/],
  massiveWriteThresholdBytes: 128 * 1024 * 1024,
  heavyWriteThresholdBytes: 16 * 1024 * 1024,
  ultraLightWriteThresholdBytes: 64 * 1024
});
assert.deepEqual(
  {
    ultraLight: lanes.ultraLight.map((entry) => entry.label),
    light: lanes.light.map((entry) => entry.label),
    heavy: lanes.heavy.map((entry) => entry.label),
    massive: lanes.massive.map((entry) => entry.label)
  },
  {
    ultraLight: ['tiny.json'],
    light: ['report.json'],
    heavy: ['field_tokens.parts'],
    massive: ['chunk_meta.binary-columnar.bundle']
  },
  'expected lane planner to classify writes deterministically'
);

const writes = [];
const schedulerCalls = [];
const phasePatches = [];
const publishedPieces = [];
const planner = createQueuedArtifactWritePlanner({
  writes,
  scheduler: {
    schedule(queueName, tokens, fn) {
      schedulerCalls.push({ queueName, tokens });
      return Promise.resolve().then(() => fn());
    }
  },
  effectiveAbortSignal: null,
  hugeWriteInFlightBudgetBytes: 1024 * 1024 * 1024,
  massiveWriteIoTokens: 2,
  massiveWriteMemTokens: 1,
  resolveArtifactWriteMemTokens: (estimatedBytes) => (estimatedBytes > 0 ? 1 : 0),
  updateActiveWriteMeta: (label, patch) => {
    phasePatches.push({ label, patch });
  },
  addPieceFile: (entry, filePath) => {
    publishedPieces.push({ entry, filePath });
  },
  forcedMassiveWritePatterns: [],
  forcedHeavyWritePatterns: [],
  forcedUltraLightWritePatterns: [],
  massiveWriteThresholdBytes: 128 * 1024 * 1024,
  heavyWriteThresholdBytes: 16 * 1024 * 1024,
  ultraLightWriteThresholdBytes: 64 * 1024
});

planner.enqueueWrite('chunk_meta.binary-columnar.bundle', async ({ setPhase }) => {
  setPhase('publish');
  return { bytes: 123 };
}, {
  estimatedBytes: 300 * 1024 * 1024,
  laneHint: 'massive',
  eagerStart: true,
  publishedPieces: [{
    entry: { type: 'chunks', name: 'chunk_meta', format: 'binary-columnar' },
    filePath: 'chunk_meta.binary-columnar.bundle'
  }]
});

assert.equal(writes.length, 1, 'expected enqueued write to be recorded');
await writes[0].prefetched;
assert.equal(schedulerCalls.length, 1, 'expected eager-start write to prefetch immediately');
assert.equal(
  schedulerCalls[0].queueName,
  'stage2.write',
  'expected eager prefetch to use the stage2 write queue'
);
assert.equal(
  phasePatches.some((entry) => entry.patch?.phase === 'publish'),
  true,
  'expected job phase updates to flow through planner tracking'
);
assert.deepEqual(
  publishedPieces,
  [{
    entry: { type: 'chunks', name: 'chunk_meta', format: 'binary-columnar' },
    filePath: 'chunk_meta.binary-columnar.bundle'
  }],
  'expected published piece metadata to register after successful completion'
);

console.log('artifact write queue planner test passed');
