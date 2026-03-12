#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const captured = [];
const runner = createProcessRunner({
  appendLog: (line) => {
    if (line) captured.push(String(line));
  },
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory: [],
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {},
  sampleProcessActivity: async (pid) => ({
    alive: true,
    pid,
    cpuMs: 0,
    rssBytes: 64 * 1024 * 1024
  })
});

const activeScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:start', { taskId: 'overall', stage: 'overall', current: 0, total: 3, message: 'start' });",
  '  await wait(40);',
  "  emit('task:progress', { taskId: 'overall', stage: 'overall', current: 1, total: 3, message: 'progress 1' });",
  '  await wait(40);',
  "  emit('task:progress', { taskId: 'overall', stage: 'overall', current: 2, total: 3, message: 'progress 2' });",
  '  await wait(40);',
  "  emit('task:end', { taskId: 'overall', stage: 'overall', current: 3, total: 3, status: 'done', message: 'done' });",
  '  process.exit(0);',
  '})();'
].join('');

const activeResult = await runner.runProcess(
  'bench-idle-progress-active',
  process.execPath,
  ['-e', activeScript],
  {
    continueOnError: true,
    idleTimeoutMs: 50,
    timeoutMs: 500
  }
);

assert.equal(activeResult.ok, true, 'expected active progress events to keep subprocess alive past idle timeout budget');

const silentScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:start', { taskId: 'overall', stage: 'overall', current: 0, total: 2, message: 'start' });",
  '  await wait(10_000);',
  '})();'
].join('');

const silentResult = await runner.runProcess(
  'bench-idle-progress-silent',
  process.execPath,
  ['-e', silentScript],
  {
    continueOnError: true,
    idleTimeoutMs: 80,
    timeoutMs: 1000
  }
);

assert.equal(silentResult.ok, false, 'expected silent subprocess to fail');
assert.equal(silentResult.timeoutKind, 'idle', 'expected idle timeout classification');
assert.equal(
  captured.some((line) => line.includes('[run] idle timeout: bench-idle-progress-silent')),
  true,
  'expected idle timeout summary log line'
);

console.log('bench language process idle-timeout test passed');
