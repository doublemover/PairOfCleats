#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const runner = createProcessRunner({
  appendLog: () => {},
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory: [],
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {}
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

console.log('bench language process timeout decision test passed');
