#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildCheckpointTracker } from '../../../src/index/build/build-state/progress.js';

let releaseFirst, releaseFinal, firstStarted, finalStarted;
const first = new Promise(resolve => { releaseFirst = resolve; });
const final = new Promise(resolve => { releaseFinal = resolve; });
const enteredFirst = new Promise(resolve => { firstStarted = resolve; });
const enteredFinal = new Promise(resolve => { finalStarted = resolve; });
const calls = [];
const tracker = createBuildCheckpointTracker({ buildRoot: 'checkpoint-finish-race', mode: 'code', totalFiles: 1, batchSize: 1,
  updateBuildStateOutcome: async (_root, _patch, options) => {
    calls.push(options.waitForFlush);
    if (calls.length === 1) { firstStarted(); await first; }
    else { finalStarted(); await final; }
    return { status: 'flushed' };
  } });
tracker.tick(); await enteredFirst;
let finished = false;
const finishing = tracker.finish().then(() => { finished = true; });
releaseFirst(); await enteredFinal;
assert.deepEqual(calls, [false, true]);
assert.equal(finished, false, 'finish waits for the forced final persistence');
releaseFinal(); await finishing;
console.log('checkpoint finish retains forced durability across an in-flight periodic write');
