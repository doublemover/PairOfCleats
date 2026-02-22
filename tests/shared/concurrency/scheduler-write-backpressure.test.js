#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  writeBackpressure: {
    enabled: true,
    writeQueue: 'stage2.write',
    producerQueues: ['stage1.cpu'],
    pendingThreshold: 1,
    pendingBytesThreshold: Number.MAX_SAFE_INTEGER,
    oldestWaitMsThreshold: Number.MAX_SAFE_INTEGER
  }
});

let releaseFirstWrite = null;
const firstWrite = scheduler.schedule('stage2.write', { io: 1 }, async () => (
  new Promise((resolve) => {
    releaseFirstWrite = resolve;
  })
));
await sleep(10);

let releaseSecondWrite = null;
let secondWriteStarted = false;
const secondWrite = scheduler.schedule('stage2.write', { io: 1 }, async () => {
  secondWriteStarted = true;
  return new Promise((resolve) => {
    releaseSecondWrite = resolve;
  });
});
await sleep(10);

let producerStarted = false;
const producer = scheduler.schedule('stage1.cpu', { cpu: 1 }, async () => {
  producerStarted = true;
  return 'producer';
});

await sleep(25);
assert.equal(producerStarted, false, 'expected producer queue to be backpressured by write tail');

releaseFirstWrite();
await sleep(25);
assert.equal(secondWriteStarted, true, 'expected queued write task to start after write token release');
await producer;

releaseSecondWrite();
await Promise.all([firstWrite, secondWrite]);

const stats = scheduler.stats();
assert.equal(stats?.adaptive?.writeBackpressure?.queue, 'stage2.write');
assert.ok(
  Array.isArray(stats?.adaptive?.writeBackpressure?.producerQueues)
  && stats.adaptive.writeBackpressure.producerQueues.includes('stage1.cpu'),
  'expected producer queues to be exposed in scheduler stats'
);

scheduler.shutdown();
console.log('scheduler write backpressure test passed');
