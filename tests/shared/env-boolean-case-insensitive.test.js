#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getEnvConfig } from '../../src/shared/env.js';

const config = getEnvConfig({
  PAIROFCLEATS_CACHE_REBUILD: 'TRUE',
  PAIROFCLEATS_VERBOSE: 'YeS',
  PAIROFCLEATS_DEBUG_CRASH: 'On',
  PAIROFCLEATS_DEBUG_PERF_EVENTS: 'false',
  PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB: '256'
});

assert.equal(config.cacheRebuild, true, 'expected uppercase TRUE to be treated as true');
assert.equal(config.verbose, true, 'expected mixed-case YeS to be treated as true');
assert.equal(config.debugCrash, true, 'expected On to be treated as true');
assert.equal(config.debugPerfEvents, false, 'expected false to remain false');
assert.equal(config.denseBinaryMaxInlineMb, 256, 'expected dense binary inline limit to normalize to number');

console.log('env boolean case-insensitive test passed');
