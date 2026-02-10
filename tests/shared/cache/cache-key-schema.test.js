#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildCacheKey,
  buildCacheKeyPayload,
  normalizeCacheNamespace
} from '../../../src/shared/cache-key.js';

const base = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['zeta', 'alpha'],
  pathPolicy: 'posix'
});
const reordered = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['alpha', 'zeta'],
  pathPolicy: 'posix'
});
const differentMode = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'prose',
  schemaVersion: 'sv1',
  featureFlags: ['alpha', 'zeta'],
  pathPolicy: 'posix'
});

assert.equal(base.key, reordered.key, 'cache key should be flag-order independent');
assert.notEqual(base.key, differentMode.key, 'cache key should change when mode changes');
assert.match(base.key, /^[a-z0-9-]+:ck1:[a-f0-9]{40}$/);

const payload = buildCacheKeyPayload({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['b', 'a'],
  pathPolicy: true
});
assert.equal(payload.featureFlags, 'a,b');
assert.equal(payload.pathPolicy, 'native');

assert.equal(normalizeCacheNamespace(' Repo/Cache Value '), 'repo-cache-value');

console.log('cache key schema test passed');
