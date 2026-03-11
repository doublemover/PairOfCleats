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
  onProgressEvent: () => {}
});

const cpuBusyScript = [
  'const endAt = Date.now() + 2600;',
  'const allocations = [];',
  'let lastAllocAt = 0;',
  'while (Date.now() < endAt) {',
  '  for (let index = 0; index < 200000; index += 1) Math.sqrt(index);',
  '  if (Date.now() - lastAllocAt >= 350 && allocations.length < 4) {',
  '    allocations.push(Buffer.alloc(2 * 1024 * 1024, 1));',
  '    lastAllocAt = Date.now();',
  '  }',
  '}',
  'process.exit(0);'
].join('');

const result = await runner.runProcess(
  'bench-idle-activity-probe',
  process.execPath,
  ['-e', cpuBusyScript],
  {
    continueOnError: true,
    idleTimeoutMs: 900,
    timeoutMs: 6000
  }
);

assert.equal(result.ok, true, 'expected active child CPU or RSS activity to suppress idle timeout');
assert.equal(
  captured.some((line) => line.includes('[run] idle timeout: bench-idle-activity-probe')),
  false,
  'expected no idle-timeout warning for CPU-active child'
);

console.log('bench language process idle activity probe test passed');
