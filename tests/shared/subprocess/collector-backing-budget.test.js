#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCollector } from '../../../src/shared/subprocess/options.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const collector = createCollector({ enabled: true, maxOutputBytes: 7, encoding: 'utf8' });
const oversized = Buffer.alloc(256 * 1024, 'x');
Buffer.from('tailEND').copy(oversized, oversized.length - 7);
collector.push(oversized);
assert.equal(collector.toOutput('string'), 'tailEND');
assert.equal(collector.stats().retainedBufferBytes, 7, 'a retained subarray must not keep the original oversized backing allocation');
for (let i = 0; i < 130; i++) {
  collector.push(Buffer.from(String(i % 10)));
  assert.equal(collector.stats().retainedBufferBytes, 7, 'consumed slots release their buffer ownership before deferred array compaction');
}
const backing = new ArrayBuffer(8192);
const small = Buffer.from(backing, 1024, 2);
small.fill('z'); collector.push(small);
assert.equal(collector.stats().retainedBufferBytes, 7, 'small views of shared/pooled backing allocations are copied into admitted owned storage');
assert.equal(collector.stats().retainedBytes, 7);

const result = await spawnSubprocess(process.execPath, ['-e', "process.stdout.write('x'.repeat(512 * 1024) + 'tailEND')"], {
  stdio: ['ignore', 'pipe', 'ignore'], maxOutputBytes: 7, captureStderr: false, timeoutMs: 5000
});
assert.equal(result.stdout, 'tailEND');
assert.equal(result.outputCapture.stdout.observedBytes, 512 * 1024 + 7);
assert.equal(result.outputCapture.stdout.retainedBytes, 7);
assert.equal(result.outputCapture.stdout.retainedBufferBytes, 7);
assert.equal(result.outputCapture.stdout.truncated, true);
console.log('Subprocess collector releases evicted backing allocations and retains only the admitted tail.');
