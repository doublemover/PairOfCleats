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

console.log('process-files progress module test passed');
