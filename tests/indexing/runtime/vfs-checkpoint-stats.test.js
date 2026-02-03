#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';

const recorder = createStageCheckpointRecorder({ mode: 'code' });

recorder.record({
  stage: 'stage2',
  step: 'write',
  extra: {
    vfsManifest: {
      rows: 10,
      bytes: 1024,
      maxLineBytes: 256,
      trimmedRows: 2,
      droppedRows: 1,
      runsSpilled: 0
    }
  }
});

recorder.record({
  stage: 'stage2',
  step: 'write',
  extra: {
    vfsManifest: {
      rows: 15,
      bytes: 900,
      maxLineBytes: 512,
      trimmedRows: 4,
      droppedRows: 3,
      runsSpilled: 1
    }
  }
});

const summary = recorder.buildSummary();
const stageSummary = summary.stages.stage2;
assert(stageSummary, 'stage summary should exist');

const vfsHighWater = stageSummary.extraHighWater?.vfsManifest;
assert(vfsHighWater, 'vfsManifest high water should exist');

assert.equal(vfsHighWater.rows, 15);
assert.equal(vfsHighWater.bytes, 1024);
assert.equal(vfsHighWater.maxLineBytes, 512);
assert.equal(vfsHighWater.trimmedRows, 4);
assert.equal(vfsHighWater.droppedRows, 3);
assert.equal(vfsHighWater.runsSpilled, 1);

console.log('vfs checkpoint stats ok');
