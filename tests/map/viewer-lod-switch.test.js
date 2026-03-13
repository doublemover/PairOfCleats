#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveLodTier } from '../../src/map/isometric/client/lod.js';
import { performanceDefaults } from '../../src/map/isometric/client/defaults.js';

const perf = { ...performanceDefaults, lod: { ...performanceDefaults.lod } };

const full = resolveLodTier({ zoom: 30, edgeCount: 1000, frameMs: 8, performance: perf });
assert.equal(full, 'full');

const simplified = resolveLodTier({ zoom: 10, edgeCount: 4000, frameMs: 20, performance: perf });
assert.equal(simplified, 'simplified');

const hidden = resolveLodTier({ zoom: 4, edgeCount: 15000, frameMs: 40, performance: perf });
assert.equal(hidden, 'hidden');

console.log('map viewer LOD switch test passed');
