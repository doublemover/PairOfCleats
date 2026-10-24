#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
const queue = new PQueue({ concurrency: 8 }); queue.maxPending = 8;
let releaseOldest, siblings = 0, races = 0, raceInputs = 0;
const held = new Promise(resolve => { releaseOldest = resolve; });
const originalRace = Promise.race;
Promise.race = function (items) { const values = [...items]; races += 1; raceInputs += values.length; return originalRace.call(this, values); };
try {
  const output = await runWithQueue(queue, Array.from({ length: 256 }, (_, index) => index), async index => {
    if (index === 0) await held;
    else { await new Promise(resolve => setImmediate(resolve)); siblings += 1; if (siblings === 255) releaseOldest(); }
    return index;
  });
  assert.deepEqual(output, Array.from({ length: 256 }, (_, index) => index));
  assert.ok(raceInputs < 600, `capacity notifications do not subscribe to each pending completion: ${races}/${raceInputs}`);
  assert.equal(queue.inflightBytes, 0);
} finally { Promise.race = originalRace; releaseOldest(); }
