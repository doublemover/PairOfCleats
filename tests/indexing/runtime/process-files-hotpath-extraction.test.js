#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const processFilesPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files.js');
const progressPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'progress.js');
const stageTimingPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'stage-timing.js');
const shardExecutionPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'shard-execution.js');
const resultsPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'results.js');

for (const target of [processFilesPath, progressPath, stageTimingPath, shardExecutionPath, resultsPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected stage1 hot-path module: ${target}`);
}

const processFilesSource = fs.readFileSync(processFilesPath, 'utf8');

for (const marker of [
  "./process-files/progress.js",
  "./process-files/stage-timing.js",
  "./process-files/shard-execution.js",
  "./process-files/results.js",
  'executeStage1ShardProcessing(',
  'finalizeStage1ProcessingResult('
]) {
  assert.equal(
    processFilesSource.includes(marker),
    true,
    `expected process-files hot path to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const createStage1ProgressTracker = (',
  'const buildStageTimingBreakdownPayload = () => ({',
  'const runShardWorker = async (workerContext) => {'
]) {
  assert.equal(
    processFilesSource.includes(legacyInlineMarker),
    false,
    `expected top-level process-files module to stop inlining ${legacyInlineMarker}`
  );
}

console.log('process-files hotpath extraction test passed');
