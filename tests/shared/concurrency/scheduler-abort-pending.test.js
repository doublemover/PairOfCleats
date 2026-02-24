#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1
});
scheduler.registerQueue('abort-contract', { priority: 10, maxPending: 4 });

let releaseFirst = null;
const first = scheduler.schedule('abort-contract', { cpu: 1 }, async () => new Promise((resolve) => {
  releaseFirst = resolve;
}));

await sleep(5);
const queuedAbort = new AbortController();
const second = scheduler.schedule('abort-contract', { cpu: 1, signal: queuedAbort.signal }, async () => 'second');
await sleep(5);
queuedAbort.abort(new Error('abort queued scheduler task'));

await assert.rejects(
  second,
  (err) => err?.code === 'ABORT_ERR',
  'expected queued scheduler task to reject with abort error before start'
);

const preAborted = new AbortController();
preAborted.abort(new Error('pre-aborted scheduler task'));
await assert.rejects(
  () => scheduler.schedule('abort-contract', { cpu: 1, signal: preAborted.signal }, async () => 'never'),
  (err) => err?.code === 'ABORT_ERR',
  'expected pre-aborted scheduler task to reject immediately'
);

releaseFirst();
await first;

const stats = scheduler.stats();
assert.equal(stats?.queues?.['abort-contract']?.pending, 0, 'expected no pending tasks after abort handling');
assert.equal(stats?.queues?.['abort-contract']?.rejectedAbort, 1, 'expected one queue-level aborted pending task');
assert.equal(stats?.counters?.rejectedByReason?.abort, 2, 'expected global abort rejection counter to include queued + pre-aborted');

scheduler.shutdown();
console.log('scheduler abort pending test passed');
