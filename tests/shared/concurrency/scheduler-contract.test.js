#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1
});
scheduler.registerQueue('contract', { priority: 10, maxPending: 1 });

let release = null;
const first = scheduler.schedule('contract', { cpu: 1 }, async () => (
  new Promise((resolve) => {
    release = resolve;
  })
));

await sleep(5);
const second = scheduler.schedule('contract', { cpu: 1 }, async () => 'second');
await assert.rejects(
  () => scheduler.schedule('contract', { cpu: 1 }, async () => 'third'),
  /maxPending/
);

release();
await Promise.all([first, second]);

const stats = scheduler.stats();
assert.equal(stats?.counters?.scheduled, 3, 'expected scheduled count to include rejected work');
assert.equal(stats?.counters?.completed, 2, 'expected completed count for accepted work');
assert.equal(stats?.counters?.rejected, 1, 'expected rejected count for maxPending overflow');
assert.equal(stats?.queues?.contract?.scheduled, 3, 'expected queue scheduled count');
assert.equal(stats?.queues?.contract?.rejected, 1, 'expected queue rejection count');

scheduler.shutdown();
await assert.rejects(
  () => scheduler.schedule('contract', { cpu: 1 }, async () => null),
  /shut down/
);

console.log('scheduler contract test passed');
