#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../src/shared/concurrency/scheduler-core.js';
import { BundleTransformOwner, bundleTransformHeapContract } from '../../src/shared/bundle-io/transform-owner.js';
import { applyTestEnv } from '../helpers/test-env.js';
applyTestEnv({ testing: '1' });
const signal = new AbortController().signal;
const bundle = { value: 'x'.repeat(500000) };
const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1 });
const owner = new BundleTransformOwner({ scheduler, signal });
try {
  await scheduler.schedule('file', { cpu: 1, signal }, async () => {
    const result = await owner.run({ operation: 'checksum-only', payload: { bundle } });
    if (bundleTransformHeapContract().supported) {
      assert.equal(result.ok, true); assert.ok(result.result.checksum?.value);
      const again = await owner.run({ operation: 'checksum-only', payload: { bundle } });
      assert.deepEqual(again.result, result.result);
      assert.equal(owner.stats().workersStarted, 1);
    } else { assert.equal(result.reason, 'heap-bound-unavailable'); }
    assert.equal(scheduler.stats().tokens.cpu.used, 1);
  });
} finally { await owner.close(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
const bounded = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 100 });
const boundedOwner = new BundleTransformOwner({ scheduler: bounded, signal });
try {
  await bounded.schedule('file', { cpu: 1, mem: 1, bytes: 100, signal }, async () => {
    const result = await boundedOwner.run({ operation: 'checksum-only', payload: { bundle } });
    assert.equal(result.ok, false);
    assert.equal(result.reason, bundleTransformHeapContract().supported ? 'scheduler-admission-busy' : 'heap-bound-unavailable');
    assert.equal(bounded.stats().tokens.cpu.used, 1, 'inline fallback retains compute authority');
    assert.equal(boundedOwner.stats().workersStarted, 0);
  });
} finally { await boundedOwner.close(); await bounded.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
