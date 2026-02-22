#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createBuildScheduler,
  createSchedulerQueueAdapter
} from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  adaptive: true,
  adaptiveIntervalMs: 1,
  cpuTokens: 8,
  ioTokens: 8,
  memoryTokens: 8,
  queues: {
    'stage1.cpu': { priority: 10, surface: 'parse' }
  },
  adaptiveSurfaces: {
    enabled: true,
    parse: {
      minConcurrency: 2,
      maxConcurrency: 2,
      initialConcurrency: 2,
      upCooldownMs: 0,
      downCooldownMs: 0,
      oscillationGuardMs: 0
    }
  }
});

const cpuQueue = createSchedulerQueueAdapter({
  scheduler,
  queueName: 'stage1.cpu',
  tokens: { cpu: 1 },
  concurrency: 2
});
const procQueue = createSchedulerQueueAdapter({
  scheduler,
  queueName: 'stage1.proc',
  tokens: { mem: 1 },
  concurrency: 2
});

let procTasksStarted = 0;
const nested = Promise.all([
  cpuQueue.add(async () => {
    await procQueue.add(async () => {
      procTasksStarted += 1;
      await sleep(5);
      return 'p1';
    });
    return 'c1';
  }),
  cpuQueue.add(async () => {
    await procQueue.add(async () => {
      procTasksStarted += 1;
      await sleep(5);
      return 'p2';
    });
    return 'c2';
  })
]);

const timeoutResult = Symbol('timeout');
const result = await Promise.race([
  nested,
  sleep(750).then(() => timeoutResult)
]);

assert.notEqual(result, timeoutResult, 'nested stage1.proc tasks should not deadlock under parse cap');
assert.equal(procTasksStarted, 2, 'expected both nested stage1.proc tasks to run');

scheduler.shutdown();

console.log('scheduler stage1.proc nested deadlock test passed');
