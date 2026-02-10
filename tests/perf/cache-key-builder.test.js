#!/usr/bin/env node
import {
  buildCacheKey,
  normalizeCacheFlags,
  normalizeCacheNamespace,
  resolvePathPolicy
} from '../../src/shared/cache-key.js';

const fail = (message) => {
  console.error(`cache key builder test failed: ${message}`);
  process.exit(1);
};

const flags = normalizeCacheFlags(['beta', 'alpha', '', 'alpha']);
if (flags !== 'alpha,alpha,beta') {
  fail(`expected flags to be normalized + sorted, got "${flags}"`);
}

const ns = normalizeCacheNamespace(' My Cache ');
if (ns !== 'my-cache') {
  fail(`expected namespace normalization to yield "my-cache", got "${ns}"`);
}

const policy = resolvePathPolicy(null);
if (policy !== 'posix' && policy !== 'native') {
  fail(`expected resolved path policy, got "${policy}"`);
}

const base = {
  namespace: 'my-cache',
  repoHash: 'repo-hash',
  buildConfigHash: 'config-hash',
  mode: 'code',
  schemaVersion: 's1',
  featureFlags: ['beta', 'alpha'],
  pathPolicy: 'posix'
};

const first = buildCacheKey(base);
const second = buildCacheKey({
  ...base,
  featureFlags: ['alpha', 'beta']
});

if (first.key !== second.key) {
  fail('expected cache keys to be deterministic regardless of flag ordering');
}

if (!first.key.startsWith('my-cache:ck1:')) {
  fail(`expected key to include namespace + version, got "${first.key}"`);
}

if (!first.serialized.includes('repo-hash|config-hash|code|s1|alpha,beta|posix')) {
  fail(`unexpected serialized payload: "${first.serialized}"`);
}

console.log('cache key builder tests passed');
