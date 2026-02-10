#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';

const defaults = resolveTreeSitterRuntime({});
assert.equal(defaults.treeSitterScheduler.transport, 'disk', 'expected default scheduler transport=disk');
assert.equal(defaults.treeSitterScheduler.sharedCache, false, 'expected default shared cache disabled');

const shmConfig = resolveTreeSitterRuntime({
  treeSitter: {
    scheduler: {
      transport: 'shm',
      sharedCache: true
    }
  }
});
assert.equal(shmConfig.treeSitterScheduler.transport, 'shm', 'expected explicit shm transport config');
assert.equal(shmConfig.treeSitterScheduler.sharedCache, true, 'expected shared cache config to pass through');

const invalidTransport = resolveTreeSitterRuntime({
  treeSitter: {
    scheduler: {
      transport: 'invalid'
    }
  }
});
assert.equal(invalidTransport.treeSitterScheduler.transport, 'disk', 'expected invalid transport fallback to disk');

console.log('tree-sitter scheduler deferred options test passed');
