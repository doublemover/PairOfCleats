#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';

const defaults = resolveTreeSitterRuntime({});
assert.equal(defaults.treeSitterScheduler.transport, 'disk', 'expected default scheduler transport=disk');
assert.equal(defaults.treeSitterScheduler.sharedCache, false, 'expected default shared cache disabled');
assert.equal(defaults.treeSitterScheduler.closeTimeoutMs, null, 'expected default scheduler close timeout unset');
assert.equal(defaults.treeSitterScheduler.closeForceAfterMs, null, 'expected default scheduler force-close timeout unset');

const shmConfig = resolveTreeSitterRuntime({
  treeSitter: {
    scheduler: {
      transport: 'shm',
      sharedCache: true,
      lookup: {
        maxOpenReaders: 12,
        closeTimeoutMs: 7000,
        closeForceAfterMs: 1500
      }
    }
  }
});
assert.equal(shmConfig.treeSitterScheduler.transport, 'shm', 'expected explicit shm transport config');
assert.equal(shmConfig.treeSitterScheduler.sharedCache, true, 'expected shared cache config to pass through');
assert.equal(shmConfig.treeSitterScheduler.maxOpenReaders, 12, 'expected scheduler lookup reader cap to pass through');
assert.equal(shmConfig.treeSitterScheduler.closeTimeoutMs, 7000, 'expected scheduler lookup close timeout to pass through');
assert.equal(shmConfig.treeSitterScheduler.closeForceAfterMs, 1500, 'expected scheduler lookup force-close timeout to pass through');
assert.equal(shmConfig.treeSitterScheduler.lookup.maxOpenReaders, 12, 'expected normalized lookup reader cap');
assert.equal(shmConfig.treeSitterScheduler.lookup.closeTimeoutMs, 7000, 'expected normalized lookup close timeout');
assert.equal(shmConfig.treeSitterScheduler.lookup.closeForceAfterMs, 1500, 'expected normalized lookup force-close timeout');

const invalidTransport = resolveTreeSitterRuntime({
  treeSitter: {
    scheduler: {
      transport: 'invalid'
    }
  }
});
assert.equal(invalidTransport.treeSitterScheduler.transport, 'disk', 'expected invalid transport fallback to disk');
assert.equal(invalidTransport.treeSitterScheduler.closeTimeoutMs, null, 'expected invalid scheduler timeout fallback to null');

console.log('tree-sitter scheduler deferred options test passed');
