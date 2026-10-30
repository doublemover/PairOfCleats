import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const contains = (error, expected) => error === expected || Boolean(error?.cause && contains(error.cause, expected))
  || Boolean(error?.errors?.some(value => contains(value, expected)));
for (const kind of ['cancel', 'crash', 'timeout']) {
  const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1, adaptive: false,
    queues: { 'stage1.cpu': { concurrency: 1 } } });
  let settled = false, replacement = false;
  const original = Object.assign(new Error('original ' + kind + ' child cleanup pending'), {
    code: kind === 'timeout' ? 'SUBPROCESS_TIMEOUT' : kind === 'cancel' ? 'ABORT_ERR' : 'SUBPROCESS_CRASH',
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
  });
  const request = { cpu: 1, io: 1, mem: 1, bytes: 64, signal: new AbortController().signal };
  await assert.rejects(scheduler.schedule('stage1.cpu', request, () => { throw original; }), error => contains(error, original));
  const pending = scheduler.schedule('stage1.cpu', request, () => { replacement = true; });
  await tick();
  assert.equal(replacement, false, 'original child must retain admission after task rejection until its captured settlement confirms');
  assert.equal(scheduler.stats().tokens.cpu.used, 1); assert.equal(scheduler.stats().runningTasks, 1);
  assert.equal(scheduler.stats().tokens.io.used, 1); assert.equal(scheduler.stats().tokens.mem.used, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 64);
  // Replacing writable diagnostic fields cannot qualify the captured resource.
  original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
  await tick(); assert.equal(replacement, false); assert.equal(scheduler.stats().tokens.cpu.used, 1);
  settled = true;
  const until = Date.now() + 1000;
  while (!replacement && Date.now() < until) { scheduler.stats(); await new Promise(resolve => setTimeout(resolve, 10)); }
  await pending; assert.equal(replacement, true); assert.equal(scheduler.stats().tokens.cpu.used, 0);
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1 });
let closed = false, drained = false;
const original = Object.freeze(Object.assign(new Error('original child close pending during scheduler shutdown'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => closed
}));
await assert.rejects(scheduler.schedule('stage1.cpu', { cpu: 1, mem: 1, signal: new AbortController().signal }, () => { throw original; }));
const draining = scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }).then(() => { drained = true; });
await tick(); assert.equal(drained, false); assert.equal(scheduler.stats().tokens.cpu.used, 1);
closed = true; await draining; assert.equal(scheduler.stats().tokens.cpu.used, 0);
console.log('Parser cancellation/crash/timeout failures retain exact CPU/IO/memory/byte reservations until original child settlement.');
