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
    "process.stdout.write(`TRACKED_PID=${child.pid}\\n`);",
    "process.emit('SIGTERM', 'SIGTERM');",
    'setInterval(() => {}, 1000);'
  ]
});

const { closeResult, stdout, stderr } = await runInlineNodeScript(inlineScript);
const trackedPid = readTrackedPidFromStdout(stdout);

const terminatedBySignal = closeResult.signal === 'SIGTERM';
const terminatedByCode = closeResult.exitCode === 143;
const terminatedByWindowsSignalCode = closeResult.exitCode === 1;
assert.equal(
  terminatedBySignal || terminatedByCode || terminatedByWindowsSignalCode,
  true,
  `expected helper process to terminate via SIGTERM forwarding; exitCode=${closeResult.exitCode} signal=${closeResult.signal} stderr=${stderr || '<empty>'}`
);

const childTerminated = await waitFor(() => !isAlive(trackedPid), 5000);
assert.equal(childTerminated, true, 'expected tracked child process to be terminated after SIGTERM cleanup');

console.log('tracked subprocess signal cleanup test passed');
