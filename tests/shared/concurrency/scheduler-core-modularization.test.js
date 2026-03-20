#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schedulerCorePath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core.js');
const schedulerIndexPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'index.js');
const schedulerConfigPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'config.js');
const schedulerAdaptiveControllerPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'adaptive-controller.js');
const schedulerQueueLifecyclePath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'queue-lifecycle.js');
const schedulerDispatchPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'dispatch.js');
const schedulerShutdownPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core', 'shutdown.js');
const policyPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-policy.js');
const queueStatePath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-queue-state.js');
const statsPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-stats.js');

for (const target of [
  schedulerCorePath,
  schedulerIndexPath,
  schedulerConfigPath,
  schedulerAdaptiveControllerPath,
  schedulerQueueLifecyclePath,
  schedulerDispatchPath,
  schedulerShutdownPath,
  policyPath,
  queueStatePath,
  statsPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected scheduler modularization file: ${target}`);
}

const source = fs.readFileSync(schedulerCorePath, 'utf8');
const indexSource = fs.readFileSync(schedulerIndexPath, 'utf8');

for (const marker of [
  "./scheduler-core/index.js"
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected scheduler core to delegate via ${marker}`
  );
}

for (const marker of [
  "./config.js",
  "./adaptive-controller.js",
  "./queue-lifecycle.js",
  "./dispatch.js",
  "./shutdown.js",
  'buildSchedulerStatsSnapshot(',
  'createSchedulerTelemetryCapture('
]) {
  assert.equal(
    indexSource.includes(marker),
    true,
    `expected scheduler core index to compose ${marker}`
  );
}

for (const legacyInlineMarker of [
  'export function createBuildScheduler(input = {}) {',
  'const shouldRequireSignalForQueue = (queueName) => (',
  'const maybeAdaptTokens = () => {',
  'const pump = () => {',
  'const shutdown = ({'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected scheduler core to stop inlining ${legacyInlineMarker}`
  );
}

console.log('scheduler core modularization test passed');
