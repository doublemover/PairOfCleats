#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createQueryPlanDiskCache } from '../../../src/retrieval/query-plan-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'query-plan-disk-cache-corrupt-evicts-file');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
const cachePath = path.join(tempRoot, 'queryPlanCache.json');
fs.writeFileSync(cachePath, '{not-json', 'utf8');

const cache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 8,
  ttlMs: 60_000,
  maxBytes: 1024 * 1024
});

const loaded = cache.load();
assert.equal(loaded, 0, 'expected corrupted disk cache file to load zero entries');
assert.equal(fs.existsSync(cachePath), false, 'expected corrupted cache file to be removed');

console.log('query plan disk cache corrupt-evicts-file test passed');
