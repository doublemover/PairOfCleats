import assert from 'node:assert/strict';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';

const run = (script, options = {}) => spawnSubprocessSync(process.execPath, ['-e', script], {
  timeoutMs: 3000, maxOutputBytes: 16, rejectOnNonZeroExit: false, ...options
});
const complete = run("process.stdout.write('complete'); process.stderr.write('diagnostic'); process.exitCode = 7;");
assert.equal(complete.exitCode, 7);
assert.equal(complete.stdout, 'complete');
assert.equal(complete.stderr, 'diagnostic');
assert.equal(complete.outputCapture.stdout.observedBytes, 8);
assert.equal(complete.outputCapture.stdout.truncated, false);
assert.equal(complete.outputCapture.stdout.encodingLoss, false);
const truncated = run("process.stdout.write('a'.repeat(32) + 'end');");
assert.equal(truncated.stdout, 'a'.repeat(13) + 'end');
assert.equal(truncated.outputCapture.stdout.droppedBytes, 19);
assert.equal(truncated.outputCapture.stdout.truncated, true);
const invalid = run('process.stdout.write(Buffer.from([0xff]));');
assert.equal(invalid.outputCapture.stdout.encodingLoss, true);
const disabled = run("process.stdout.write('ignored');", { captureStdout: false });
assert.equal(disabled.stdout, undefined);
assert.equal(disabled.outputCapture.stdout.enabled, false);
const lines = run("process.stdout.write('a\\nb\\n');", { outputMode: 'lines' });
assert.deepEqual(lines.stdout, ['a', 'b']);
assert.equal(lines.outputCapture.stdout.truncated, false);
console.log('sync subprocess capture receipts test passed');
