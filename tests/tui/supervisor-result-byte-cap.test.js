#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';

ensureTestingEnv(process.env);
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
let sequence = 0;
const run = async (source, captureStdout, maxBytes) => {
  const jobId = `byte-cap-${++sequence}`;
  session.send({ op: 'job:run', jobId, command: process.execPath,
    args: ['-e', source], resultPolicy: { captureStdout, maxBytes } });
  const end = await session.waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'done', JSON.stringify(end));
  return end;
};
try {
  await session.waitForEvent((event) => event.event === 'hello');
  for (const bytes of [7, 8, 9]) {
    const end = await run(`process.stdout.write('x'.repeat(${bytes}))`, 'text', 8);
    assert.equal(end.resultState, bytes > 8 ? 'truncated' : 'complete');
    assert.equal(end.resultCapture.observedBytes, bytes);
    assert.equal(end.resultCapture.retainedBytes, Math.min(bytes, 8));
    assert(end.resultCapture.retainedBufferBytes <= 8);
    assert.equal(Buffer.byteLength(end.result), Math.min(bytes, 8));
    const json = await run(`process.stdout.write(JSON.stringify('x'.repeat(${bytes - 2})))`, 'json', 8);
    assert.equal(json.resultState, bytes > 8 ? 'truncated' : 'complete');
    assert.equal(json.resultCapture.observedBytes, bytes);
    assert.equal(json.result, bytes > 8 ? null : 'x'.repeat(bytes - 2));
  }
  const unicode = await run("process.stdout.write('🙂🙂🙂')", 'text', 5);
  assert.equal(unicode.resultState, 'truncated');
  assert(Buffer.byteLength(unicode.result) <= 5);
  const large = await run("process.stdout.write('x'.repeat(1200000))", 'text', 2000000);
  assert.equal(large.resultState, 'complete');
  assert.equal(large.result.length, 1200000);
  const largeJson = await run("process.stdout.write(JSON.stringify({value:'x'.repeat(1200000)}))", 'json', 2000000);
  assert.equal(largeJson.resultState, 'complete');
  assert.equal(largeJson.result.value.length, 1200000);
  const split = await run("const b=Buffer.from('🙂🙂');process.stdout.write(b.subarray(0,3));setTimeout(()=>process.stdout.write(b.subarray(3)),10)", 'text', 8);
  assert.equal(split.resultState, 'complete');
  assert.equal(split.result, '🙂🙂');
  const disabled = await run("process.stdout.write('x'.repeat(100000))", 'none', 8);
  assert.equal(disabled.resultState, 'disabled');
  assert.equal(disabled.result, null);
  assert.equal(disabled.resultCapture.retainedBytes, 0);
  const invalid = await run("process.stdout.write('{broken}')", 'json', 100);
  assert.equal(invalid.resultState, 'invalid-json');
  assert.equal(invalid.result, null);
  const truncated = await run("process.stdout.write(JSON.stringify({value:'0123456789'}))", 'json', 8);
  assert.equal(truncated.resultState, 'truncated');
  assert.equal(truncated.result, null);
  const valid = await run("process.stdout.write(JSON.stringify({ok:true}))", 'json', 32);
  assert.equal(valid.resultState, 'complete');
  assert.deepEqual(valid.result, { ok: true });
  assert.equal(await session.shutdown(), 0);
  console.log('supervisor result byte cap test passed');
} catch (error) {
  session.forceKill();
  throw error;
}
