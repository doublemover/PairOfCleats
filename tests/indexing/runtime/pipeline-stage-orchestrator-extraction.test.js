#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pipelinePath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline.js');
const orchestratorPath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline', 'orchestrator.js');
const stageSequencerPath = path.join(root, 'src', 'index', 'build', 'indexer', 'pipeline', 'stage-sequencer.js');
const pipelineSource = fs.readFileSync(pipelinePath, 'utf8');
const orchestratorSource = fs.readFileSync(orchestratorPath, 'utf8');
const stageSequencerSource = fs.readFileSync(stageSequencerPath, 'utf8');

assert.match(pipelineSource, /runPipelineStageOrchestrator\(/, 'expected pipeline to delegate stage sequencing to orchestrator');

for (const marker of [
  'runDiscovery(',
  'preScanImports(',
  'processFiles(',
  'postScanImports(',
  'buildIndexPostings(',
  'runCrossFileInference(',
  'writeIndexArtifactsForMode('
]) {
  assert.equal(
    pipelineSource.includes(marker),
    false,
    `expected top-level pipeline module to stop inlining ${marker}`
  );
  assert.equal(
    orchestratorSource.includes(marker),
    true,
    `expected orchestrator module to own ${marker}`
  );
}

const stageOrder = ['discover', 'imports', 'processing', 'relations', 'postings', 'write'];
const stagePositions = stageOrder.map((stageId) => stageSequencerSource.indexOf(`{ id: '${stageId}'`));
assert.equal(stagePositions.every((value) => value >= 0), true, 'expected all stage ids in shared stage plan');
for (let index = 1; index < stagePositions.length; index += 1) {
  assert.equal(
    stagePositions[index] > stagePositions[index - 1],
    true,
    `expected ${stageOrder[index - 1]} to precede ${stageOrder[index]} in stage plan`
  );
}

console.log('pipeline stage orchestrator extraction test passed');
