#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const schedulerCorePath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core.js');
const policyPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-policy.js');
const queueStatePath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-queue-state.js');
const statsPath = path.join(root, 'src', 'shared', 'concurrency', 'scheduler-core-stats.js');

for (const target of [schedulerCorePath, policyPath, queueStatePath, statsPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected scheduler modularization file: ${target}`);
}

const source = fs.readFileSync(schedulerCorePath, 'utf8');

for (const marker of [
  "./scheduler-core-policy.js",
  "./scheduler-core-queue-state.js",
  "./scheduler-core-stats.js",
  'buildSchedulerStatsSnapshot(',
  'recordSchedulerQueueWaitTime(',
  'clearSchedulerQueue('
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected scheduler core to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolvePercentile = (values, ratio) => {',
  'const recordQueueWaitTime = (queue, waitedMs) => {',
  'const stats = () => {\n    captureTelemetryIfDue(\'stats\');'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected scheduler core to stop inlining ${legacyInlineMarker}`
  );
}

console.log('scheduler core modularization test passed');
