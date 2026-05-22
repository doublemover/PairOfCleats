#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1
});

let releaseOversized = null;
let oversizedStarted = false;
const oversized = scheduler.schedule('oversized', { io: 2, mem: 2 }, async () => {
  oversizedStarted = true;
  return new Promise((resolve) => {
    releaseOversized = resolve;
  });
});

await sleep(20);
assert.equal(oversizedStarted, true, 'expected a single oversized token request to start when pools are idle');

let regularStarted = false;
const regular = scheduler.schedule('regular', { io: 1 }, async () => {
  regularStarted = true;
  return 'regular';
});

await sleep(20);
assert.equal(regularStarted, false, 'expected normal token gating while oversized work is running');

releaseOversized('oversized');
assert.equal(await oversized, 'oversized');
assert.equal(await regular, 'regular');
assert.equal(regularStarted, true, 'expected regular work to start after oversized tokens release');

scheduler.shutdown();
console.log('scheduler oversized token request test passed');
