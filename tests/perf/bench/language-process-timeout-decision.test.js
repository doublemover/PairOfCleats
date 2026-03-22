#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const logLines = [];
const runner = createProcessRunner({
  appendLog: (line) => logLines.push(String(line || '')),
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory: [],
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {},
  sampleProcessActivity: async () => null
});

const queueSilentScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:start', { taskId: 'overall', stage: 'overall', current: 0, total: 4, message: 'start', inFlight: 4, meta: { queueAgeMs: 220 } });",
  '  await wait(10_000);',
  '})();'
].join('');

const idleResult = await runner.runProcess(
  'bench-timeout-decision-idle',
  process.execPath,
  ['-e', queueSilentScript],
  {
    continueOnError: true,
    idleTimeoutMs: 100,
    timeoutMs: 1000
  }
);

assert.equal(idleResult.ok, false, 'expected idle timeout result');
assert.equal(idleResult.timeoutKind, 'idle', 'expected idle timeout kind');
assert.equal(
  idleResult.timeoutDecision?.timeoutClass,
  'no_queue_movement',
  'expected queue movement timeout classification'
);

const hardResult = await runner.runProcess(
  'bench-timeout-decision-hard',
  process.execPath,
  ['-e', 'setTimeout(() => {}, 10_000);'],
  {
    continueOnError: true,
    timeoutMs: 120
  }
);

assert.equal(hardResult.ok, false, 'expected hard timeout result');
assert.equal(hardResult.timeoutKind, 'hard', 'expected hard timeout kind');
assert.equal(
  hardResult.timeoutDecision?.timeoutClass,
  'global_wall_clock_cap',
  'expected wall clock timeout classification'
);
assert.equal(hardResult.timeoutDecision?.phase, 'execute', 'expected default hard timeout phase attribution');
assert.equal(hardResult.timeoutDecision?.resourceClass, 'cpu-bound', 'expected default hard timeout resource attribution');
assert.equal(
  hardResult.timeoutDecision?.failureMode,
  'phase_stalled',
  'expected no-progress hard timeout to be classified as phase stalled'
);

const providerTimeoutScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const progress = (payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event: 'log', ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  progress({ level: 'warn', stage: 'tooling', taskId: 'tooling:gopls', message: '[tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked' });",
  "  progress({ level: 'warn', stage: 'tooling', taskId: 'tooling:pyright', message: '[tooling] request:timeout provider=pyright method=textDocument/documentSymbol stage=documentSymbol workspacePartition=python class=timeout' });",
  "  progress({ level: 'warn', stage: 'tooling', taskId: 'tooling:pyright', message: '[tooling] pyright degraded mode active (fail-open).' });",
  '  await wait(10_000);',
  '})();'
].join('');

const providerHardResult = await runner.runProcess(
  'bench-timeout-decision-provider',
  process.execPath,
  ['-e', providerTimeoutScript],
  {
    continueOnError: true,
    timeoutMs: 160
  }
);

assert.equal(providerHardResult.ok, false, 'expected provider hard timeout result');
assert.equal(providerHardResult.timeoutKind, 'hard', 'expected provider timeout kind');
assert.equal(providerHardResult.timeoutDecision?.phase, 'provider_bootstrap', 'expected provider phase attribution');
assert.equal(providerHardResult.timeoutDecision?.resourceClass, 'provider-bound', 'expected provider resource attribution');
assert.equal(
  providerHardResult.timeoutDecision?.failureMode,
  'budget_exhausted_with_progress',
  'expected provider timeout with live progress signals to be classified as budget exhausted with progress'
);
assert.deepEqual(
  providerHardResult.timeoutDecision?.qualityDelta?.skippedWork,
  ['provider-enrichment', 'provider-requests', 'workspace-preflight'],
  'expected provider timeout quality delta to surface skipped enrichment classes'
);

const artifactTimeoutScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const progress = (payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event: 'log', ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  progress({ level: 'warn', stage: 'write', taskId: 'write:field-postings', message: 'artifact tail stalled for 32000ms while writing field_postings.json shard' });",
  "  progress({ level: 'warn', stage: 'watchdog', taskId: 'stage:watchdog', message: '[tree-sitter:schedule] queue delay hotspot 1450ms' });",
  '  await wait(10_000);',
  '})();'
].join('');

const artifactHardResult = await runner.runProcess(
  'bench-timeout-decision-artifact',
  process.execPath,
  ['-e', artifactTimeoutScript],
  {
    continueOnError: true,
    timeoutMs: 160
  }
);

assert.equal(artifactHardResult.ok, false, 'expected artifact hard timeout result');
assert.equal(artifactHardResult.timeoutDecision?.phase, 'artifact_write', 'expected artifact phase attribution');
assert.equal(artifactHardResult.timeoutDecision?.resourceClass, 'write-bound', 'expected write-bound resource attribution');
assert.equal(
  artifactHardResult.timeoutDecision?.failureMode,
  'budget_exhausted_with_progress',
  'expected artifact timeout with queue activity to be classified as budget exhausted with progress'
);

const extensionScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:start', { taskId: 'overall', stage: 'overall', current: 200, total: 400, message: 'start', inFlight: 4, meta: { queueAgeMs: 180 } });",
  '  await wait(180);',
  "  emit('task:progress', { taskId: 'overall', stage: 'overall', current: 260, total: 400, message: 'resumed', inFlight: 4, meta: { queueAgeMs: 160 } });",
  '  await wait(25);',
  '})();',
  'setTimeout(() => process.exit(0), 260);'
].join('');

const extensionResult = await runner.runProcess(
  'bench-timeout-decision-extend',
  process.execPath,
  ['-e', extensionScript],
  {
    continueOnError: true,
    idleTimeoutMs: 100,
    timeoutMs: 900
  }
);

assert.equal(extensionResult.ok, true, 'expected progress extension run to complete');
console.log('bench language process timeout decision test passed');
