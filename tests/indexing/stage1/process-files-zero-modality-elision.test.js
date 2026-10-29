#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { processFiles } from '../../../src/index/build/indexer/steps/process-files.js';
import { resolveFileLifecycleDurations } from '../../../src/index/build/indexer/steps/process-files/watchdog.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timing = {};
const state = { chunks: [] };
const phases = [];
const controller = new AbortController();
const baseline = getEventListeners(controller.signal, 'abort').length;
const result = await processFiles({
  mode: 'records',
  runtime: { root: process.cwd() },
  discovery: null,
  outDir: process.cwd(),
  entries: [],
  contextWin: 0,
  timing,
  crashLogger: {
    enabled: true,
    updatePhase: (phase) => phases.push(String(phase || '')),
    updateFile: () => {},
    logError: () => {}
  },
  state,
  perfProfile: null,
  cacheReporter: { report: () => {} },
  seenFiles: new Set(),
  incrementalState: null,
  relationsEnabled: false,
  shardPerfProfile: null,
  fileTextCache: null,
  abortSignal: controller.signal
});

assert.equal(getEventListeners(controller.signal, 'abort').length, baseline,
  'empty Stage1 must release the external abort listener');
controller.abort(new Error('after the completed stage'));
assert.equal(getEventListeners(controller.signal, 'abort').length, baseline);

const healthy = { enqueuedAtMs: 0, dequeuedAtMs: 4, parseStartAtMs: 10,
  parseEndAtMs: 30, writeStartAtMs: 31, writeEndAtMs: 35, scmProcQueueWaitMs: 3 };
assert.deepEqual(resolveFileLifecycleDurations(healthy), { queueDelayMs: 4, activeDurationMs: 20,
  scmProcQueueWaitMs: 3, activeProcessingDurationMs: 17, writeDurationMs: 4, totalDurationMs: 35 });
for (const sentinel of [null, undefined, '', NaN, Infinity]) {
  assert.equal(resolveFileLifecycleDurations({ ...healthy, enqueuedAtMs: sentinel }).queueDelayMs, 0);
  assert.equal(resolveFileLifecycleDurations({ ...healthy, parseStartAtMs: sentinel }).activeDurationMs, 0);
  assert.equal(resolveFileLifecycleDurations({ ...healthy, writeStartAtMs: sentinel }).writeDurationMs, 0);
  assert.equal(resolveFileLifecycleDurations({ ...healthy, writeEndAtMs: sentinel }).totalDurationMs, 24);
}
assert.deepEqual(resolveFileLifecycleDurations({ enqueuedAtMs: null, dequeuedAtMs: Date.now(),
  parseStartAtMs: null, parseEndAtMs: Date.now(), writeStartAtMs: null, writeEndAtMs: null }),
{ queueDelayMs: 0, activeDurationMs: 0, scmProcQueueWaitMs: 0,
  activeProcessingDurationMs: 0, writeDurationMs: 0, totalDurationMs: 0 });
assert.equal(resolveFileLifecycleDurations({ ...healthy, dequeuedAtMs: -1 }).queueDelayMs, 0);

assert.equal(result?.stageElided, true, 'expected stage-elided result for zero-modality input');
assert.equal(timing.processMs, 0, 'expected zero processing duration for elided stage');
assert.equal(
  state?.modalityStageElisions?.records?.chunkCount,
  0,
  'expected stage-elision metadata for records mode'
);
assert.equal(
  phases.includes('processing'),
  true,
  'expected crash logger phase update before stage elision return'
);

console.log('process-files zero-modality elision test passed');
