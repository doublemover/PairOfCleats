#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const captured = [];
const logHistory = [];
const runner = createProcessRunner({
  appendLog: (line) => {
    if (line) captured.push(String(line));
  },
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory,
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {}
});

const result = await runner.runProcess(
  'bench-timeout-contract',
  process.execPath,
  ['-e', 'setInterval(() => {}, 1000)'],
  {
    continueOnError: true,
    timeoutMs: 80
  }
);

assert.equal(result.ok, false, 'expected timeout subprocess to fail');
assert.equal(
  typeof result.code === 'number' && result.code !== 0,
  true,
  'expected timeout subprocess to return non-zero code'
);
assert.ok(result.diagnostics && typeof result.diagnostics === 'object', 'expected diagnostics summary on timeout');
assert.ok(
  result.progressConfidence && typeof result.progressConfidence === 'object',
  'expected progress-confidence summary on timeout'
);
assert.equal(
  captured.some((line) => line.includes('[run] timeout: bench-timeout-contract')),
  true,
  'expected timeout summary log line'
);

console.log('bench language process timeout test passed');
