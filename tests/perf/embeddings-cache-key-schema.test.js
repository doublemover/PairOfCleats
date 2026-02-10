#!/usr/bin/env node
import { buildCacheKey } from '../../tools/build/embeddings/cache.js';

const fail = (message) => {
  console.error(`embeddings cache key schema test failed: ${message}`);
  process.exit(1);
};

const base = {
  file: 'src/index.js',
  hash: 'hash-1',
  signature: 'sig-1',
  identityKey: 'ident-1',
  repoId: 'repo-1',
  mode: 'code',
  featureFlags: ['normalize'],
  pathPolicy: 'posix'
};

const key = buildCacheKey(base);
if (!key || typeof key !== 'string') {
  fail('expected cache key to be generated');
}
if (!key.startsWith('pairofcleats:ck1:')) {
  fail(`expected cache key to include namespace+version prefix, got "${key}"`);
}

const keyMode = buildCacheKey({ ...base, mode: 'prose' });
if (keyMode === key) {
  fail('expected cache key to change when mode changes');
}

const keyIdentity = buildCacheKey({ ...base, identityKey: 'ident-2' });
if (keyIdentity === key) {
  fail('expected cache key to change when identityKey changes');
}

console.log('embeddings cache key schema test passed');
