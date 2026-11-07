import assert from 'node:assert/strict';
import { createWorkerCleanupGroup } from '../../../src/index/build/workers/pool/cleanup-group.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const original of [null, false, 0, '', Object.freeze(new Error('original frozen close')), new Error('original close')]) {
  let firstClosed = false, secondClosed = false, allowClose = false, calls = 0, siblingCalls = 0;
  const gate = deferred(), entered = deferred();
  const group = createWorkerCleanupGroup([
    { close() { siblingCalls++; secondClosed = true; }, isSettled: () => secondClosed },
    { async close() { calls++; entered.resolve(); await gate.promise; if (!allowClose) throw original; firstClosed = true; }, isSettled: () => firstClosed }
  ]);
  const first = group.destroy(), concurrent = group.destroy();
  assert.equal(first, concurrent);
  const rejected = assert.rejects(first, error => error.errors.includes(original)
    && error.cause === original && error.cacheOwnershipReleased() === false);
  await entered.promise; assert.equal(calls, 1); assert.equal(siblingCalls, 1); assert.equal(group.isSettled(), false);
  gate.resolve(); await rejected;
  allowClose = true; await group.destroy(); await group.destroy();
  assert.equal(calls, 2); assert.equal(siblingCalls, 1); assert.equal(group.isSettled(), true);
}
{
  let calls = 0, closed = false;
  const diagnostic = Object.freeze(new Error('post-close diagnostic'));
  const group = createWorkerCleanupGroup([{ close() { calls++; closed = true; throw diagnostic; }, isSettled: () => closed }]);
  await assert.rejects(group.destroy(), error => error === diagnostic);
  await assert.rejects(group.destroy(), error => error === diagnostic);
  assert.equal(calls, 1); assert.equal(group.isSettled(), true);
}
{
  const primary = new Error('original close failed'), observerFailure = Object.freeze(new Error('original observer failed'));
  let retry = false, calls = 0;
  const group = createWorkerCleanupGroup([{ close() { calls++; if (!retry) throw primary; },
    isSettled() { throw observerFailure; } }]);
  await assert.rejects(group.destroy(), error => error.errors[0] === primary && error.errors[1] === observerFailure
    && error.cacheOwnershipReleased() === false);
  retry = true; await group.destroy(); await group.destroy(); assert.equal(calls, 2);
}
console.log('Opt-in worker cleanup preserves falsey/frozen failures, exact retry, settled diagnostics and failed observations.');
