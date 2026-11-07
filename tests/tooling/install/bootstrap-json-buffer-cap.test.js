// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import { runSetupCommand } from '../../../tools/setup/owned-command.js';

let received;
const chunks = [];
const result = await runSetupCommand('inert-bootstrap-child', [], { stdio: ['inherit', 'pipe', 'pipe'],
  captureStdout: false, captureStderr: false, onStdout: chunk => chunks.push(chunk) }, {
  spawn: async (_command, _args, options) => {
    received = options;
    options.onStdout('inert streamed tail');
    return { exitCode: 0 };
  }
});
assert.equal(received.captureStdout, false);
assert.equal(received.captureStderr, false);
assert.equal(received.maxOutputBytes, 1024 * 1024);
assert.deepEqual(chunks, ['inert streamed tail']);
assert.equal(result.stdout, '', 'streamed progress has no retained full-output buffer');
await runSetupCommand('inert-tooling-detector', [], { stdio: 'pipe' }, {
  spawn: async (_command, _args, options) => {
    assert.equal(options.captureStdout, true, 'machine tooling JSON remains captured and bounded');
    assert.equal(options.maxOutputBytes, 1024 * 1024);
    return { exitCode: 0, stdout: '{"tools":[]}' };
  }
});
console.log('Bootstrap progress streams without an oversized captured output buffer.');
