#!/usr/bin/env node
import assert from 'node:assert/strict';

import { finalizeStage1ProcessingResult } from '../../../src/index/build/indexer/steps/process-files/results.js';

const timing = {};
const state = {};
let checkpointFinished = 0;
const checkpoint = {
  async finish() {
    checkpointFinished += 1;
  }
};

const input = {
  mode: 'code',
  log() {},
  logLine() {},
  logLexiconFilterAggregate() {},
  timing,
  state,
  shardSummary: [{ id: 'shard-a', fileCount: 2 }],
  shardPlan: [{ id: 'shard-a' }],
  shardExecutionMeta: { enabled: true, shardCount: 1 },
  stallRecovery: { softKickAttempts: 1 },
  checkpoint,
  processStart: Date.now() - 25,
  buildStageTimingBreakdownPayload: () => ({
    watchdog: {
      queueDelayMs: { summary: { count: 1, totalMs: 10 } },
      nearThreshold: { anomaly: false }
    }
  }),
  buildExtractedProseLowYieldBailoutSummary: () => ({ enabled: false }),
  extractedProseLowYieldBailout: null,
  stage1WindowPlannerConfig: { enabled: true },
  stage1WindowReplanIntervalMs: 1000,
  stage1WindowReplanMinSeqAdvance: 1,
  stage1WindowReplanAttemptCount: 2,
  stage1WindowReplanChangedCount: 1,
  stage1LastWindowTelemetry: { changed: true },
  stage1SeqWindows: [{
    windowId: 'win-1',
    startSeq: 1,
    endSeq: 2,
    entryCount: 2,
    predictedCost: 10,
    predictedBytes: 100
  }],
  resolveStage1WindowSnapshot: () => ({ activeWindows: [{ windowId: 'win-1' }] }),
  expectedOrderIndices: [1, 2],
  getStage1ProgressSnapshot: () => ({
    count: 2,
    total: 2,
    completedOrderIndices: [1, 2]
  }),
  orderedAppender: {
    snapshot() {
      return {
        terminalCount: 2,
        committedCount: 2,
        totalSeqCount: 2,
        nextCommitSeq: 3
      };
    }
  },
  resolveStage1OrderingIntegrity: () => ({
    ok: true,
    missingIndices: [],
    missingCount: 0,
    expectedCount: 2,
    progressCount: 2,
    progressTotal: 2
  }),
  startOrderIndex: 1,
  orderIndexToRel: new Map([
    [1, 'src/a.js'],
    [2, 'src/b.js']
  ]),
  postingsQueue: {
    stats() {
      return { pendingCount: 0, pendingBytes: 0 };
    }
  },
  tokenizationStats: { tokens: 12 }
};
const result = await finalizeStage1ProcessingResult(input);

assert.equal(checkpointFinished, 1, 'expected finalize helper to await checkpoint completion');
assert.equal(result.tokenizationStats.tokens, 12);
assert.equal(result.shardExecution.enabled, true);
assert.deepEqual(result.postingsQueueStats, { pendingCount: 0, pendingBytes: 0 });
assert.deepEqual(state.postingsQueueStats, { pendingCount: 0, pendingBytes: 0 });
assert.equal(timing.shards.enabled, true);
assert.equal(timing.watchdog.stallRecovery.softKickAttempts, 1);
assert.equal(Array.isArray(state.stage1Windows.windows), true);

for (const indices of [[0, 2], [7, 11, 20], []]) {
  const start = indices[0] || 0;
  const successor = indices.length ? indices[indices.length - 1] + 1 : start;
  const sparse = { ...input, expectedOrderIndices: indices, startOrderIndex: start,
    getStage1ProgressSnapshot: () => ({ count: indices.length, total: indices.length, completedOrderIndices: indices }),
    orderedAppender: { snapshot: () => ({ terminalCount: indices.length, committedCount: indices.length,
      totalSeqCount: indices.length, nextCommitSeq: successor }) } };
  await finalizeStage1ProcessingResult(sparse);
  for (const invalid of [successor + 1, -1, NaN, 0.5]) {
    await assert.rejects(finalizeStage1ProcessingResult({ ...sparse,
      orderedAppender: { snapshot: () => ({ ...sparse.orderedAppender.snapshot(), nextCommitSeq: invalid }) } }),
    { code: 'STAGE1_COMMIT_CURSOR_INVARIANT' });
  }
}

console.log('process-files results module test passed');
