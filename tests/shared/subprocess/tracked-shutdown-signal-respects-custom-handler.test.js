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
  beforeSpawn: [
    "process.on('SIGTERM', () => {",
    "  process.stdout.write('CUSTOM_HANDLER\\n');",
    "  setTimeout(() => {",
    "    process.stdout.write('CUSTOM_DONE\\n');",
    '    process.exit(0);',
    '  }, 100);',
    '});'
  ],
  afterRegister: [
    "process.stdout.write(`TRACKED_PID=${child.pid}\\n`);",
    "process.emit('SIGTERM', 'SIGTERM');",
    'setInterval(() => {}, 1000);'
  ]
});

const { closeResult, stdout, stderr } = await runInlineNodeScript(inlineScript);
const trackedPid = readTrackedPidFromStdout(stdout);

assert.equal(stdout.includes('CUSTOM_HANDLER'), true, 'expected custom SIGTERM handler to run');
assert.equal(stdout.includes('CUSTOM_DONE'), true, 'expected custom SIGTERM handler completion marker');
assert.equal(
  closeResult.exitCode,
  0,
  `expected custom handler to control shutdown exit code; signal=${closeResult.signal} stderr=${stderr || '<empty>'}`
);
assert.equal(closeResult.signal, null, 'expected custom handler shutdown to be code-based');

const childTerminated = await waitFor(() => !isAlive(trackedPid), 5000);
assert.equal(childTerminated, true, 'expected tracked child process to be terminated during custom shutdown');

console.log('tracked subprocess signal custom-handler test passed');
