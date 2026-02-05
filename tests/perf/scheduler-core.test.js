#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runTokenGating = async () => {
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1,
    queues: {
      core: { priority: 50 }
    }
  });

  const order = [];
  let release = null;
  const first = scheduler.schedule('core', { cpu: 1 }, async () => {
    order.push('start1');
    await new Promise((resolve) => {
      release = resolve;
    });
    order.push('end1');
  });

  await sleep(10);
  const second = scheduler.schedule('core', { cpu: 1 }, async () => {
    order.push('start2');
    order.push('end2');
  });

  await sleep(10);
  assert.deepEqual(order, ['start1']);

  release();
  await Promise.all([first, second]);

  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2']);
};

const runMaxPending = async () => {
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1,
    queues: {
      core: { priority: 50, maxPending: 1 }
    }
  });

  let release = null;
  const first = scheduler.schedule('core', { cpu: 1 }, async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
  });

  await sleep(5);
  const second = scheduler.schedule('core', { cpu: 1 }, async () => {
    return null;
  });

  let rejected = false;
  try {
    await scheduler.schedule('core', { cpu: 1 }, async () => null);
  } catch {
    rejected = true;
  }

  assert.equal(rejected, true);
  release();
  await Promise.all([first, second]);
};

const runLowResourceMode = async () => {
  const scheduler = createBuildScheduler({
    lowResourceMode: true,
    cpuTokens: 0,
    ioTokens: 0,
    memoryTokens: 0
  });
  let ran = false;
  await scheduler.schedule('core', { cpu: 1 }, async () => {
    ran = true;
  });
  assert.equal(ran, true);
};

await runTokenGating();
await runMaxPending();
await runLowResourceMode();

console.log('scheduler core test passed');
