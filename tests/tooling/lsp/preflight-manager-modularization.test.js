#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const managerPath = path.join(root, 'src', 'index', 'tooling', 'preflight-manager.js');
const configPath = path.join(root, 'src', 'index', 'tooling', 'preflight', 'manager-config.js');
const statePath = path.join(root, 'src', 'index', 'tooling', 'preflight', 'manager-state.js');
const schedulerPath = path.join(root, 'src', 'index', 'tooling', 'preflight', 'manager-scheduler.js');
const teardownPath = path.join(root, 'src', 'index', 'tooling', 'preflight', 'manager-teardown.js');

for (const target of [managerPath, configPath, statePath, schedulerPath, teardownPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected preflight modularization file: ${target}`);
}

const source = fs.readFileSync(managerPath, 'utf8');

for (const marker of [
  "./preflight/manager-config.js",
  "./preflight/manager-state.js",
  "./preflight/manager-scheduler.js",
  "./preflight/manager-teardown.js",
  'resolvePreflightTimeoutMs(',
  'resolvePreflightKey(',
  'scheduleTask(',
  'forceCleanupTrackedPreflightProcesses('
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected preflight manager to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolveSchedulerConfig = (ctx) => {',
  'const createManagedAbortBridge = (upstreamSignal) => {',
  'const runScheduledTask = ({ state, ctx, task, fromQueue = false }) => {',
  'const waitForPromisesWithTimeout = async (promises, timeoutMs) => {'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected preflight manager to stop inlining ${legacyInlineMarker}`
  );
}

console.log('preflight manager modularization test passed');
