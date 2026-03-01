#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFederatedQueryCache } from '../../../src/retrieval/federation/query-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-cache-corrupt-'));
const cachePath = path.join(tempRoot, 'queryCache.json');
await fs.writeFile(cachePath, '{not-json', 'utf8');

const warnings = [];
const health = {};
const cache = await loadFederatedQueryCache({
  cachePath,
  repoSetId: 'ws-corrupt',
  log: (message) => warnings.push(String(message)),
  health
});

assert.equal(cache?.schemaVersion, 1, 'expected empty cache schema payload after parse failure');
assert.equal(
  Object.keys(cache?.entries || {}).length,
  0,
  'expected parse failure to fail open with empty federated cache entries'
);
assert.equal(health.federatedQueryCacheParseFailures, 1, 'expected parse failure health counter');
assert.equal(
  warnings.some((entry) => entry.includes('cache parse failed')),
  true,
  'expected parse warning message'
);
const originalExists = await fs.stat(cachePath).then(() => true).catch(() => false);
assert.equal(originalExists, false, 'expected corrupted federated cache file to be quarantined');
const files = await fs.readdir(tempRoot);
assert.equal(
  files.some((entry) => entry.startsWith('queryCache.json.corrupt-')),
  true,
  'expected quarantined federated cache file marker'
);

console.log('federated query cache corrupt quarantine test passed');
