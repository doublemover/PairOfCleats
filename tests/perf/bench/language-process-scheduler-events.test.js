#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const logHistory = [];
const runner = createProcessRunner({
  appendLog: (line) => {
    if (line) logHistory.push(String(line));
  },
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory,
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {}
});

const script = [
  "console.log(JSON.stringify({ event: 'log', level: 'info', message: '[tree-sitter:schedule] queue depth 3', stage: 'processing', taskId: 'stage:code' }));",
  "console.error('[tree-sitter:schedule] stderr fallback');",
  'process.exit(2);'
].join('');

const result = await runner.runProcess(
  'scheduler-events',
  process.execPath,
  ['-e', script],
  { continueOnError: true }
);

assert.equal(result.ok, false, 'expected subprocess to fail for scheduler event capture test');
assert.equal(result.code, 2, 'expected failure code');
assert.ok(Array.isArray(result.schedulerEvents), 'expected scheduler events array on process result');
assert.ok(result.schedulerEvents.length >= 2, 'expected scheduler events captured from progress event and stderr');
assert.equal(
  result.schedulerEvents.some((entry) => String(entry?.message || '').includes('queue depth 3')),
  true,
  'expected scheduler progress event in capture window'
);
assert.equal(
  result.schedulerEvents.some((entry) => String(entry?.message || '').includes('stderr fallback')),
  true,
  'expected scheduler stderr fallback line in capture window'
);

console.log('bench language process scheduler events test passed');
