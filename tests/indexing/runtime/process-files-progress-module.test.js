#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildFileProgressHeartbeatText,
  createStage1ProgressTracker
} from '../../../src/index/build/indexer/steps/process-files/progress.js';

const checkpoint = {
  ticks: 0,
  tick() {
    this.ticks += 1;
  }
};

const tracker = createStage1ProgressTracker({
  total: 4,
  mode: 'code',
  checkpoint
});

assert.equal(tracker.markOrderedEntryComplete(10), true, 'expected first ordered entry to advance progress');
assert.equal(tracker.markOrderedEntryComplete(10), false, 'expected duplicate ordered entry to be deduped');
assert.equal(tracker.markOrderedEntryComplete(null, null, 'fallback:1'), true, 'expected fallback key to advance once');
assert.equal(tracker.markOrderedEntryComplete(null, null, 'fallback:1'), false, 'expected duplicate fallback key to be deduped');

const snapshot = tracker.snapshot();
assert.equal(snapshot.count, 2);
assert.deepEqual(snapshot.completedOrderIndices, [10]);
assert.deepEqual(snapshot.completedFallbackKeys, ['fallback:1']);
assert.equal(checkpoint.ticks, 2);

const heartbeat = buildFileProgressHeartbeatText({
  count: 2,
  total: 4,
  startedAtMs: 1_000,
  nowMs: 3_000,
  inFlight: 1,
  trackedSubprocesses: 2
});
assert.match(heartbeat, /progress 2\/4 \(50\.0%\)/);
assert.match(heartbeat, /inFlight=1 trackedSubprocesses=2/);

const weighted = createStage1ProgressTracker({ total: 3, totalInputBytes: 1048576 });
weighted.markOrderedEntryComplete(0, null, null, { inputBytes: 524288, chunks: 7, cached: true });
weighted.markOrderedEntryComplete(0, null, null, { inputBytes: 524288, chunks: 7, cached: true });
weighted.markOrderedEntryComplete(1, null, null, { inputBytes: 262144, status: 'skipped' });
weighted.markOrderedEntryComplete(2, null, null, { inputBytes: 262144, status: 'failed' });
assert.deepEqual(weighted.workloadSnapshot(), { totalInputBytes: 1048576, terminalInputBytes: 1048576,
  chunksProduced: 7, cachedFiles: 1, skippedFiles: 1, failedFiles: 1 });
const weightedSnapshot = weighted.workloadSnapshot();
weightedSnapshot.chunksProduced = 99;
assert.equal(weighted.workloadSnapshot().chunksProduced, 7);
assert.match(buildFileProgressHeartbeatText({ count: 3, total: 3, startedAtMs: 0, nowMs: 2000,
  workload: weighted.workloadSnapshot() }), /inputMiB=1.00\/1.00 inputMiB\/s=0.50 chunks=7 cached=1 skipped=1 failed=1/);
const invalid = createStage1ProgressTracker({ totalInputBytes: Infinity });
invalid.markOrderedEntryComplete(0, null, null, { inputBytes: Infinity, chunks: NaN });
assert.equal(invalid.workloadSnapshot().terminalInputBytes, 0);
assert.doesNotMatch(buildFileProgressHeartbeatText({ workload: {} }), /NaN|undefined|Infinity/);
console.log('process-files progress module test passed');
