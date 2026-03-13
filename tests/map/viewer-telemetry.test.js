#!/usr/bin/env node
import assert from 'node:assert/strict';
import { updatePerfStats } from '../../src/map/isometric/client/telemetry.js';

const perfStats = { droppedFrames: 0 };
let fpsState = { start: 0, frames: 0 };

const step = (now, frameMs) => {
  const result = updatePerfStats({
    perfStats,
    now,
    frameMs,
    budgetMs: 18,
    fpsState,
    heapUsed: 1024 * 1024
  });
  Object.assign(perfStats, result.stats);
  fpsState = result.fpsState;
};

step(0, 16);
step(16, 22);
step(32, 40);

assert.ok(perfStats.droppedFrames >= 1, 'expected dropped frame count');
assert.ok(perfStats.frameMs > 0, 'expected frameMs');
assert.ok(perfStats.heapUsed, 'expected heapUsed');

console.log('map viewer telemetry test passed');
