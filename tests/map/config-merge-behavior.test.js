#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../helpers/test-env.js';
import { mergeConfig } from '../../src/shared/config.js';

applyTestEnv();

const base = {
  controls: { orbit: true, pan: true },
  performance: {
    lod: { enabled: true, levels: [1, 2, 3] },
    drawCaps: { nodes: 1000 }
  },
  tags: ['base']
};
const override = {
  controls: { pan: false },
  performance: {
    lod: { levels: [4, 5] },
    drawCaps: { edges: 2000 }
  },
  tags: ['override']
};

const merged = mergeConfig(base, override);

assert.deepEqual(merged.controls, { orbit: true, pan: false });
assert.deepEqual(merged.performance.lod, { enabled: true, levels: [4, 5] });
assert.deepEqual(merged.performance.drawCaps, { nodes: 1000, edges: 2000 });
assert.deepEqual(merged.tags, ['override']);
assert.deepEqual(base.tags, ['base']);
assert.deepEqual(base.performance.lod.levels, [1, 2, 3]);

console.log('map config merge behavior test passed');
