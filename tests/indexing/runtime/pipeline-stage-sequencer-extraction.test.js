#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createPipelineStageAdvancer,
  INDEX_STAGE_PLAN
} from '../../../src/index/build/indexer/pipeline/stage-sequencer.js';

const root = process.cwd();
const pipelinePath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline.js');
const sequencerPath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline', 'stage-sequencer.js');
const finalizePath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline', 'finalize.js');

for (const target of [pipelinePath, sequencerPath, finalizePath]) {
  assert.equal(fs.existsSync(target), true, `missing expected pipeline modularization file: ${target}`);
}

const pipelineSource = fs.readFileSync(pipelinePath, 'utf8');
for (const marker of [
  "./pipeline/stage-sequencer.js",
  "./pipeline/finalize.js",
  'createPipelineStageAdvancer(',
  'finalizePipelineModeRun('
]) {
  assert.equal(
    pipelineSource.includes(marker),
    true,
    `expected pipeline module to delegate via ${marker}`
  );
}
assert.equal(
  pipelineSource.includes('const advanceStage = (stage) => {'),
  false,
  'expected top-level pipeline module to stop inlining stage advancement'
);

const stageMessages = [];
const telemetryStages = [];
const runtime = {
  overallProgress: {
    advance({ message }) {
      stageMessages.push(message);
    }
  }
};
const advanceStage = createPipelineStageAdvancer({
  mode: 'code',
  runtime,
  stagePlan: INDEX_STAGE_PLAN,
  setSchedulerTelemetryStage(stageId) {
    telemetryStages.push(stageId);
  },
  getSchedulerStats() {
    return { queues: [] };
  }
});

advanceStage(INDEX_STAGE_PLAN[0]);
advanceStage(INDEX_STAGE_PLAN[1]);
advanceStage(INDEX_STAGE_PLAN[2]);

assert.deepEqual(telemetryStages, ['discover', 'imports', 'processing']);
assert.deepEqual(stageMessages, ['code discovery', 'code imports']);

console.log('pipeline stage sequencer extraction test passed');
