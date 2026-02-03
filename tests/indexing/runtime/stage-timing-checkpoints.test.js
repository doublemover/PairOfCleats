#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';

const recorder = createStageCheckpointRecorder({ mode: 'code' });
recorder.record({ stage: 'stage1', step: 'start', extra: { chunks: 1 } });
await new Promise((resolve) => setTimeout(resolve, 5));
recorder.record({ stage: 'stage1', step: 'postings', extra: { chunks: 5 } });

const summary = recorder.buildSummary();
const stageSummary = summary.stages.stage1;
assert(stageSummary, 'stage summary should exist');
assert.equal(stageSummary.checkpointCount, 2);
assert(stageSummary.elapsedMs >= 0, 'elapsedMs should be non-negative');

const highWaterChunks = summary.highWater?.extra?.chunks;
assert.equal(highWaterChunks, 5);

const elapsedValues = summary.checkpoints.map((entry) => entry.elapsedMs);
assert(elapsedValues[1] >= elapsedValues[0], 'elapsedMs should be monotonic');

console.log('stage timing checkpoints ok');
