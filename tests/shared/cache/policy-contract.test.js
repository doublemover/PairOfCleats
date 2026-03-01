#!/usr/bin/env node
import assert from 'node:assert/strict';
import { defineCachePolicy, resolveCachePolicy } from '../../../src/shared/cache/policy.js';

let shutdownCalls = 0;
const basePolicy = defineCachePolicy({
  name: 'contract.cache',
  maxEntries: 5,
  maxBytes: 1024,
  ttlMs: 1000,
  invalidationTrigger: ['build-pointer-change', 'build-pointer-change', 'ttl'],
  shutdown: () => {
    shutdownCalls += 1;
  }
});

assert.equal(basePolicy.name, 'contract.cache');
assert.equal(basePolicy.maxEntries, 5);
assert.equal(basePolicy.maxBytes, 1024);
assert.equal(basePolicy.ttlMs, 1000);
assert.deepEqual(basePolicy.invalidationTriggers, ['build-pointer-change', 'ttl']);
assert.equal(basePolicy.invalidationTrigger, 'build-pointer-change');
basePolicy.shutdown();
assert.equal(shutdownCalls, 1);

const resolved = resolveCachePolicy(
  { maxEntries: 9, ttlMs: 5000 },
  basePolicy
);
assert.equal(resolved.maxEntries, 9);
assert.equal(resolved.maxBytes, 1024);
assert.equal(resolved.ttlMs, 5000);
assert.equal(resolved.invalidationTrigger, 'build-pointer-change');

let missingTriggerError = null;
try {
  defineCachePolicy({
    name: 'bad.cache.trigger',
    maxEntries: 1,
    maxBytes: null,
    ttlMs: 0,
    shutdown: () => {}
  });
} catch (err) {
  missingTriggerError = err;
}
assert.ok(missingTriggerError, 'expected missing invalidation trigger to throw');

let missingShutdownError = null;
try {
  defineCachePolicy({
    name: 'bad.cache.shutdown',
    maxEntries: 1,
    maxBytes: null,
    ttlMs: 0,
    invalidationTrigger: 'manual'
  });
} catch (err) {
  missingShutdownError = err;
}
assert.ok(missingShutdownError, 'expected missing shutdown hook to throw');

console.log('cache policy contract ok.');

