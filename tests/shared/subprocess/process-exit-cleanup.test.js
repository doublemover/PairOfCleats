#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createTrackedChildCleanupScript,
  isAlive,
  readTrackedPidFromStdout,
  runInlineNodeScript,
  waitFor
} from './tracked-cleanup-fixture.js';

const inlineScript = createTrackedChildCleanupScript({
  afterRegister: [
    "process.stdout.write(`TRACKED_PID=${child.pid}\\n`, () => process.exit(0));"
  ]
});

const { closeResult, stdout, stderr } = await runInlineNodeScript(inlineScript);

assert.equal(
  closeResult.exitCode,
  0,
  `expected helper process exit=0; signal=${closeResult.signal} stderr=${stderr || '<empty>'}`
);

const trackedPid = readTrackedPidFromStdout(stdout);

const childTerminated = await waitFor(() => !isAlive(trackedPid), 5000);
assert.equal(childTerminated, true, 'expected tracked child process to be terminated after process.exit cleanup');

console.log('tracked subprocess process-exit cleanup test passed');
