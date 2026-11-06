import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/subprocess/raw-output-observers/')[1];
assert.ok(['exact-bytes-without-capture', 'capture-and-text-isolation'].includes(mode));
const stdout = [], stderr = [], text = [];
if (mode === 'exact-bytes-without-capture') {
  const expected = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const reversed = Buffer.from(expected).reverse();
  const source = `process.stdout.write(Buffer.from(${JSON.stringify([...expected])}));
    process.stderr.write(Buffer.from(${JSON.stringify([...reversed])}));`;
  const result = await spawnSubprocess(process.execPath, ['--eval', source], { stdio: 'pipe', timeoutMs: 5000,
    captureStdout: false, captureStderr: false, maxOutputBytes: 16,
    onStdoutChunk: chunk => { assert.ok(Buffer.isBuffer(chunk)); stdout.push(chunk); }, onStderrChunk: chunk => stderr.push(chunk) });
  assert.deepEqual(Buffer.concat(stdout), expected); assert.deepEqual(Buffer.concat(stderr), reversed);
  assert.equal(result.stdout, undefined); assert.equal(result.stderr, undefined);
  for (const channel of ['stdout', 'stderr']) {
    assert.equal(result.outputCapture[channel].observedBytes, 256);
    assert.equal(result.outputCapture[channel].retainedBytes, 0); assert.equal(result.outputCapture[channel].enabled, false);
  }
} else {
  const expected = 'A🍀Z';
  const source = `process.stdout.write(Buffer.from([65,240,159]));
    setTimeout(()=>process.stdout.write(Buffer.from([141,128,90])),5);`;
  const result = await spawnSubprocess(process.execPath, ['--eval', source], { stdio: 'pipe', timeoutMs: 5000,
    maxOutputBytes: 64, onStdout: chunk => text.push(chunk), onStdoutChunk: chunk => {
      stdout.push(Buffer.from(chunk)); chunk.fill(0);
    } });
  assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected));
  assert.equal(text.join(''), expected); assert.equal(result.stdout, expected);
  assert.equal(result.outputCapture.stdout.encodingLoss, false);
}
assert.equal(getTrackedSubprocessCount(), 0);
console.log('Raw subprocess observers preserve exact bytes independently of capture and text decoding');
