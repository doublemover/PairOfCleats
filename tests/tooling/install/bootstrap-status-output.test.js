import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { writeBootstrapStatus, BOOTSTRAP_STATUS_OUTPUT_LIMITS } from '../../../tools/setup/task-progress-output.js';
import { runBootstrapTasks } from '../../../tools/setup/bootstrap-tasks.js';
import { withCheckoutMutation, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-status-output/')[1];
assert.ok(['real-completion-and-provider-capture', 'real-broken-pipe-task-drain',
  'timeout-original-checkout-retirement', 'bounded-shared-transport', 'checkout-observer-aggregation'].includes(mode));
const turn = () => new Promise(resolve => setImmediate(resolve));
if (mode === 'real-completion-and-provider-capture') {
  const chunks = []; let complete, calls = 0, returned = false;
  const stream = new Writable({ highWaterMark: 1, write(chunk, encoding, callback) {
    chunks.push(Buffer.from(chunk)); if (++calls === 1) complete = callback; else callback();
  } });
  const first = writeBootstrapStatus('one', stream).then(() => { returned = true; });
  const second = writeBootstrapStatus('two', stream);
  stream.write = () => assert.fail('caller replaced the captured original transport method');
  const third = writeBootstrapStatus('three', stream);
  try {
    await turn(); assert.equal(returned, false); assert.equal(calls, 1);
    assert.equal(stream.listenerCount('error'), 1); assert.equal(stream.listenerCount('close'), 1);
  } finally { complete(); }
  await Promise.all([first, second, third]);
  assert.equal(Buffer.concat(chunks).toString(), 'one\ntwo\nthree\n');
  assert.equal(stream.destroyed, false); assert.equal(stream.writableEnded, false);
  assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0); stream.end();
} else if (mode === 'real-broken-pipe-task-drain') {
  const compiler = Object.freeze(new Error('independent compiler failure'));
  const pipe = Object.freeze(Object.assign(new Error('actual Writable EPIPE'), { code: 'EPIPE' }));
  const stream = new Writable({ write(chunk, encoding, callback) { queueMicrotask(() => callback(pipe)); } });
  const entered = Promise.withResolvers(), aborted = Promise.withResolvers(), release = Promise.withResolvers();
  let peerRetired = false, returned = false;
  const pending = runBootstrapTasks([
    { id: 'peer', run: async ({ signal }) => {
      entered.resolve(); if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      aborted.resolve(); await release.promise; peerRetired = true;
    } },
    { id: 'compiler', run: async () => { await entered.promise; throw compiler; } }
  ], { budget: { jobs: 2, cpuCount: 2, memoryBytes: 1024 }, stopOnRequiredFailure: false,
    onEvent: event => event.taskId === 'compiler' && event.state === 'failed' ? writeBootstrapStatus('compiler failed', stream) : undefined
  }).then(() => { returned = true; assert.fail('transport failure cannot report successful bootstrap observation'); }, error => { returned = true; return error; });
  try { await aborted.promise; assert.equal(returned, false); assert.equal(peerRetired, false); }
  finally { release.resolve(); }
  const actual = await pending;
  assert.equal(peerRetired, true); assert.equal(errorGraphIncludes(actual, compiler), true); assert.equal(errorGraphIncludes(actual, pipe), true);
  assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0);
} else if (mode === 'checkout-observer-aggregation') {
  const root = await makeTempDir('bootstrap-status-aggregate-'), other = await makeTempDir('bootstrap-status-independent-');
  const entered = Promise.withResolvers(); let writes = 0, hold = false, complete, secondary;
  const stream = new Writable({ write(chunk, encoding, callback) {
    writes++; if (hold) { complete = callback; entered.resolve(); } else callback();
  } });
  try {
    await withCheckoutMutation(root, async session => {
      for (let index = 0; index < 160; index++) await writeBootstrapStatus('original status ' + index, stream, { root, session });
      hold = true;
      secondary = withCheckoutMutation(other, session => writeBootstrapStatus('independent checkout status', stream, { root: other, session }));
      secondary.catch(() => {}); await entered.promise;
    });
    assert.equal(writes, 161); assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
    assert.equal(fs.existsSync(path.join(other, CHECKOUT_MUTATION_LOCK)), true, 'a shared physical stream does not merge distinct checkout prerequisites');
    const finish = complete; complete = null; finish(); await secondary;
    assert.equal(fs.existsSync(path.join(other, CHECKOUT_MUTATION_LOCK)), false);
    assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0); assert.equal(stream.destroyed, false);
  } finally {
    if (complete) complete(); await secondary?.catch(() => {}); stream.end();
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
  }
} else if (mode === 'timeout-original-checkout-retirement') {
  const root = await makeTempDir('bootstrap-status-output-'), stream = new EventEmitter();
  let complete, writeFailure;
  stream.write = (text, callback) => { complete = callback; return true; };
  try {
    const actual = await withCheckoutMutation(root, async session => {
      const schedule = globalThis.setTimeout; let expire, pending;
      try {
        globalThis.setTimeout = (callback, timeout) => { assert.equal(timeout, BOOTSTRAP_STATUS_OUTPUT_LIMITS.timeoutMs); expire = callback; return null; };
        pending = writeBootstrapStatus('held original write', stream, { root, session });
        await turn();
      } finally { globalThis.setTimeout = schedule; }
      pending.catch(error => { writeFailure = error; }); expire(); await pending;
    }).catch(error => error);
    assert.equal(actual.cacheOwnershipReleased(), false); assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    assert.equal(typeof complete, 'function');
    writeFailure.cacheOwnershipPending = false; writeFailure.cacheOwnershipReleased = () => true;
    await assert.rejects(retireCheckoutMutationSession(actual.checkoutMutationSession));
    complete(); await turn(); await retireCheckoutMutationSession(actual.checkoutMutationSession);
    assert.equal(actual.cacheOwnershipReleased(), true); assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
    assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} else {
  const stream = new EventEmitter(), callbacks = []; let calls = 0;
  stream.write = (text, callback) => { calls++; callbacks.push(callback); return true; };
  await assert.rejects(writeBootstrapStatus('x'.repeat(BOOTSTRAP_STATUS_OUTPUT_LIMITS.lineBytes), stream), { code: 'ERR_BOOTSTRAP_STATUS_LINE' });
  await assert.rejects(writeBootstrapStatus('injected\nstatus', stream), { code: 'ERR_BOOTSTRAP_STATUS_LINE' });
  assert.equal(calls, 0); assert.equal(stream.listenerCount('error'), 0);
  const pending = Array.from({ length: BOOTSTRAP_STATUS_OUTPUT_LIMITS.pending }, () => writeBootstrapStatus('bounded', stream).catch(error => error));
  const overflow = await writeBootstrapStatus('never admitted', stream).catch(error => error);
  try {
    assert.equal(calls, BOOTSTRAP_STATUS_OUTPUT_LIMITS.pending); assert.equal(overflow.cacheOwnershipReleased(), false);
    assert.equal(stream.listenerCount('error'), 1); assert.equal(stream.listenerCount('close'), 1);
  } finally { for (const callback of callbacks) callback(); }
  const actual = await Promise.all(pending); await turn();
  assert.ok(actual.every(error => error.cacheOwnershipReleased() === true)); assert.equal(overflow.cacheOwnershipReleased(), true);
  await assert.rejects(writeBootstrapStatus('failed transport cannot retry', stream));
  assert.equal(calls, BOOTSTRAP_STATUS_OUTPUT_LIMITS.pending);
  assert.equal(stream.listenerCount('error'), 0); assert.equal(stream.listenerCount('close'), 0);
}
console.log('Bootstrap status observes real write callbacks and transport errors with bounded pending work and original checkout retirement');
