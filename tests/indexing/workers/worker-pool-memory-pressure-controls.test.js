#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';
import {
  resolveMemoryPressureState,
  resolveLanguageThrottleLimit,
  evictDeterministicPressureCacheEntries
} from '../../../src/index/build/workers/pool.js';

const config = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 12
}, { cpuLimit: 12 });

assert.equal(config.memoryPressure.watermarkSoft, 0.985, 'expected throughput-first soft watermark default');
assert.equal(config.memoryPressure.watermarkHard, 0.995, 'expected throughput-first hard watermark default');
assert.equal(config.memoryPressure.cacheMaxEntries, 2048, 'expected larger pressure cache default');
assert.equal(
  config.memoryPressure.languageThrottle.blockHeavyOnHardPressure,
  true,
  'expected hard-pressure heavy-language blocking default'
);

const softState = resolveMemoryPressureState({
  pressureRatio: 0.986,
  watermarkSoft: 0.985,
  watermarkHard: 0.995,
  currentState: 'normal'
});
assert.equal(softState, 'soft-pressure', 'expected ratio over soft watermark to enter soft-pressure state');

const hardState = resolveMemoryPressureState({
  pressureRatio: 0.997,
  watermarkSoft: 0.985,
  watermarkHard: 0.995,
  currentState: softState
});
assert.equal(hardState, 'hard-pressure', 'expected ratio over hard watermark to enter hard-pressure state');

const hardRecovery = resolveMemoryPressureState({
  pressureRatio: 0.97,
  watermarkSoft: 0.985,
  watermarkHard: 0.995,
  currentState: hardState
});
assert.equal(hardRecovery, 'soft-pressure', 'expected hard-pressure to recover through soft-pressure hysteresis');

const normalRecovery = resolveMemoryPressureState({
  pressureRatio: 0.95,
  watermarkSoft: 0.985,
  watermarkHard: 0.995,
  currentState: hardRecovery
});
assert.equal(normalRecovery, 'normal', 'expected low ratio to recover to normal state');

const throttleConfig = {
  enabled: true,
  heavyLanguages: ['lua', 'swift'],
  softMaxPerLanguage: 6,
  hardMaxPerLanguage: 2,
  blockHeavyOnHardPressure: true
};

assert.equal(
  resolveLanguageThrottleLimit({
    pressureState: 'soft-pressure',
    languageId: 'lua',
    throttleConfig
  }),
  6,
  'expected soft-pressure to throttle heavy language to soft max'
);
assert.equal(
  resolveLanguageThrottleLimit({
    pressureState: 'soft-pressure',
    languageId: 'python',
    throttleConfig
  }),
  Number.POSITIVE_INFINITY,
  'expected soft-pressure to leave non-heavy languages unthrottled'
);
assert.equal(
  resolveLanguageThrottleLimit({
    pressureState: 'hard-pressure',
    languageId: 'swift',
    throttleConfig
  }),
  0,
  'expected hard-pressure to block heavy languages by default'
);
assert.equal(
  resolveLanguageThrottleLimit({
    pressureState: 'hard-pressure',
    languageId: 'swift',
    throttleConfig: { ...throttleConfig, blockHeavyOnHardPressure: false }
  }),
  2,
  'expected hard-pressure to honor explicit non-blocking hard max override'
);

const cache = new Map([
  ['a', { sizeBytes: 10, firstSeenAt: 3 }],
  ['b', { sizeBytes: 5, firstSeenAt: 1 }],
  ['c', { sizeBytes: 10, firstSeenAt: 1 }],
  ['d', { sizeBytes: 1, firstSeenAt: 2 }]
]);

const evicted = evictDeterministicPressureCacheEntries({ cache, maxEntries: 2 });
assert.deepEqual(
  evicted.map((entry) => entry.key),
  ['c', 'a'],
  'expected deterministic eviction ordering by size desc then age asc'
);
assert.deepEqual(
  Array.from(cache.keys()),
  ['b', 'd'],
  'expected largest entries to be evicted first'
);

console.log('worker pool memory pressure controls test passed');
