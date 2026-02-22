#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  adaptive: true,
  adaptiveIntervalMs: 1,
  cpuTokens: 2,
  ioTokens: 2,
  memoryTokens: 2,
  queues: {
    'stage1.cpu': { priority: 10, surface: 'parse' },
    'stage1.io': { priority: 10, surface: 'parse' },
    'stage1.proc': { priority: 10, surface: 'parse' }
  },
  adaptiveSurfaces: {
    enabled: true,
    parse: {
      minConcurrency: 1,
      maxConcurrency: 1,
      initialConcurrency: 1,
      upCooldownMs: 0,
      downCooldownMs: 0,
      oscillationGuardMs: 0
    }
  }
});

let ioRan = false;
let procRan = false;
const nestedTask = scheduler.schedule('stage1.cpu', { cpu: 1 }, async () => {
  await scheduler.schedule('stage1.io', { io: 1 }, async () => {
    ioRan = true;
  });
  await scheduler.schedule('stage1.proc', { mem: 1 }, async () => {
    procRan = true;
  });
});

const winner = await Promise.race([
  nestedTask.then(() => 'done'),
  sleep(500).then(() => 'timeout')
]);

assert.equal(winner, 'done', 'expected nested IO/proc scheduling to complete without deadlock');
assert.equal(ioRan, true, 'expected nested IO dependency to execute');
assert.equal(procRan, true, 'expected nested proc dependency to execute');

scheduler.shutdown();

console.log('scheduler adaptive surface nested dependency deadlock test passed');
