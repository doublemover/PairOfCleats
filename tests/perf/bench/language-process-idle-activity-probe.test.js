#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const captured = [];
let probeCount = 0;
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
  sampleProcessActivity: (pid) => {
    probeCount += 1;
    return {
      alive: true,
      pid,
      cpuMs: 100 + (probeCount * 250),
      rssBytes: (64 + (probeCount * 4)) * 1024 * 1024
    };
  }
});

const quietAliveScript = [
  'setTimeout(() => process.exit(0), 2300);'
].join('');

const result = await runner.runProcess(
  'bench-idle-activity-probe',
  process.execPath,
  ['-e', quietAliveScript],
  {
    continueOnError: true,
    idleTimeoutMs: 900,
    timeoutMs: 6000
  }
);

assert.equal(result.ok, true, 'expected active child CPU or RSS activity to suppress idle timeout');
assert.ok(probeCount >= 2, 'expected idle watchdog to consult the activity probe');
assert.equal(
  captured.some((line) => line.includes('[run] idle timeout: bench-idle-activity-probe')),
  false,
  'expected no idle-timeout warning for CPU-active child'
);

console.log('bench language process idle activity probe test passed');
