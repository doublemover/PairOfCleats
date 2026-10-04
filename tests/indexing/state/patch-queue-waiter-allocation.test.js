import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createPatchQueue, PATCH_QUEUE_WAIT_STATUS } from '../../../src/index/build/build-state/patch-queue.js';

const root = path.join(os.tmpdir(), 'poc-waiter-allocation-synthetic');
let started;
let release;
const applyStarted = new Promise((resolve) => { started = resolve; });
const applyBlocked = new Promise((resolve) => { release = resolve; });
let calls = 0;
const errors = [];
const queue = createPatchQueue({
  mergeState: (base, patch) => ({ ...base, ...patch }),
  applyStatePatch: async (_root, patch, events) => {
    calls += 1;
    if (calls === 1) { started(); await applyBlocked; }
    return { patch, events };
  },
  recordStateError: (_root, error) => { errors.push(error); },
  waiterTimeoutMs: 0
});
const first = Array.from({ length: 4 }, (_, i) => queue.queueStatePatch(root, { [`a${i}`]: true }, [{ type: `a${i}` }]));
const firstFlush = queue.flushBuildState(root);
await applyStarted;
const second = Array.from({ length: 4 }, (_, i) => queue.queueStatePatch(root, { [`b${i}`]: true }, [{ type: `b${i}` }]));
const filter = Array.prototype.filter;
let waiterArrayCopies = 0;
let waiterReferencesCopied = 0;
Array.prototype.filter = function(callback, ...rest) {
  const isWaiterArray = this.length && this.every((value) => value && typeof value.resolve === 'function' && Object.hasOwn(value, 'settled'));
  const result = filter.call(this, callback, ...rest);
  if (isWaiterArray) { waiterArrayCopies += 1; waiterReferencesCopied += result.length; }
  return result;
};
try { release(); await firstFlush; }
finally { Array.prototype.filter = filter; }
const firstResults = await Promise.all(first);
assert.ok(firstResults.every((value) => value.status === PATCH_QUEUE_WAIT_STATUS.FLUSHED));
const pending = await queue.queueStatePatch(root, { telemetry: true }, [], { waitForFlush: false });
assert.equal(pending.pendingWaiterCount, 4);
const final = await queue.flushBuildState(root);
assert.equal(final.status, PATCH_QUEUE_WAIT_STATUS.FLUSHED);
const secondResults = await Promise.all(second);
assert.ok(secondResults.every((value) => value.status === PATCH_QUEUE_WAIT_STATUS.FLUSHED));
assert.equal(calls, 2);
assert.deepEqual(errors, []);
assert.equal(queue.isActiveStateKey(root), false);
assert.equal(waiterArrayCopies, 0);
assert.equal(waiterReferencesCopied, 0);
assert.deepEqual(firstResults[0].value.events.map((event) => event.type), ['a0', 'a1', 'a2', 'a3']);
assert.deepEqual(secondResults[0].value.events.map((event) => event.type), ['b0', 'b1', 'b2', 'b3']);
console.log('patch waiter allocation passed: unrelated next-batch array copies4→0, ordered outcomes and lifecycle preserved');
