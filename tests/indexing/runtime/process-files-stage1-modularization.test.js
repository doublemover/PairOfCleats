#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const processFilesPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files.js');
const runtimeStatePath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'runtime-state.js');
const watchdogPolicyPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'watchdog-policy.js');
const taskLifecyclePath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'task-lifecycle.js');
const backpressurePath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'backpressure.js');
const shardPlanPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'shard-plan.js');

for (const target of [
  processFilesPath,
  runtimeStatePath,
  watchdogPolicyPath,
  taskLifecyclePath,
  backpressurePath,
  shardPlanPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected process-files modularization file: ${target}`);
}

const source = fs.readFileSync(processFilesPath, 'utf8');

for (const marker of [
  "./process-files/runtime-state.js",
  "./process-files/watchdog-policy.js",
  "./process-files/task-lifecycle.js",
  "./process-files/backpressure.js",
  "./process-files/shard-plan.js"
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected process-files to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolveRuntimeStatePath = (runtime, fileName) => {',
  'export const resolveFileWatchdogConfig = (runtime, { repoFileCount = 0 } = {}) => {',
  'export const runCleanupWithTimeout = async ({',
  'export const shouldBypassPostingsBackpressure = ({',
  'const buildStage1ShardWorkPlan = ({'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected process-files to stop inlining ${legacyInlineMarker}`
  );
}

console.log('process-files stage1 modularization test passed');
