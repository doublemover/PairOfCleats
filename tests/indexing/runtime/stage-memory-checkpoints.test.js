#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';

const recorder = createStageCheckpointRecorder({ mode: 'code' });
recorder.record({ stage: 'stage1', step: 'discovery', extra: { files: 10 } });

const summary = recorder.buildSummary();
assert.equal(summary.mode, 'code');
assert.equal(summary.checkpoints.length, 1);

const checkpoint = summary.checkpoints[0];
assert.equal(checkpoint.stage, 'stage1');

const memory = checkpoint.memory || {};
const fields = ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'];
for (const field of fields) {
  const value = memory[field];
  if (value !== null) {
    assert.equal(Number.isFinite(value), true, `memory.${field} should be finite`);
  }
}

const stageSummary = summary.stages.stage1;
assert(stageSummary, 'stage summary should exist');
assert.equal(stageSummary.checkpointCount, 1);

console.log('stage memory checkpoints ok');
