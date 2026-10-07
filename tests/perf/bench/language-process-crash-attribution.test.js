#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildBenchCrashAttribution } from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const attribution = buildBenchCrashAttribution({
  code: 3221225477,
  signal: null,
  activeLabel: 'bench cmake/dreamworksanimation/openmoonray',
  activeChildPid: 12345,
  activePhase: 'execute',
  logHistory: [
    '[cleanup] runtime.scheduler.shutdown done (1ms)',
    '[cleanup] runtime.worker-pools.destroy start',
    'Build failed: build index'
  ]
});

assert.ok(attribution && typeof attribution === 'object', 'expected crash attribution payload');
assert.equal(attribution.crashClass, 'windows_access_violation', 'expected Windows access violation classification');
assert.equal(attribution.ntStatusHex, '0xC0000005', 'expected NTSTATUS hex rendering');
assert.equal(attribution.activeLabel, 'bench cmake/dreamworksanimation/openmoonray');
assert.equal(attribution.activeChildPid, 12345);
assert.equal(attribution.activePhase, 'execute');
assert.equal(attribution.recentCleanupLabel, 'runtime.worker-pools.destroy');
assert.equal(Array.isArray(attribution.recentLogTail), true, 'expected retained crash log tail');

const nonCrash = buildBenchCrashAttribution({
  code: 1,
  signal: null,
  logHistory: []
});

assert.equal(nonCrash, null, 'expected generic nonzero exit to avoid crash attribution');

console.log('bench language process crash attribution test passed');
