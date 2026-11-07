import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createConcurrencyLimiter } from '../../../src/integrations/tooling/providers/lsp/hover-types/concurrency.js';

const limiter = createConcurrencyLimiter(1), held = Promise.withResolvers(), entered = Promise.withResolvers();
const order = [];
const first = limiter(async () => { order.push('A'); entered.resolve(); await held.promise; });
await entered.promise;
const cancelled = new AbortController();
const second = limiter(async () => { order.push('B'); }, { signal: cancelled.signal });
const secondRejected = assert.rejects(second, { name: 'AbortError', code: 'ABORT_ERR' });
const third = limiter(async () => { order.push('C'); });
const fourth = limiter(async () => { order.push('D'); });
assert.equal(limiter.getMetrics().queued, 3);
cancelled.abort(); await secondRejected;
assert.deepEqual(order, ['A']); assert.equal(limiter.getMetrics().active, 1);
assert.equal(limiter.getMetrics().queued, 2); assert.equal(limiter.getMetrics().cancelled, 1);
assert.equal(getEventListeners(cancelled.signal, 'abort').length, 0);
held.resolve(); await Promise.all([first, third, fourth]);
// Promise callbacks settle before the release finally; join one ordinary turn.
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(order, ['A', 'C', 'D']); assert.equal(limiter.getMetrics().active, 0);
assert.equal(limiter.getMetrics().queued, 0); assert.equal(limiter.getMetrics().admitted, 3);
await assert.rejects(limiter(() => { throw new Error('must not enter'); }, { signal: cancelled.signal }), { code: 'ABORT_ERR' });
assert.equal(limiter.getMetrics().active, 0);
console.log('Queued method cancellation withdraws only its own waiter and preserves active-slot completion and neighbor order.');
