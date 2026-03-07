#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadQueryCache } from '../../../src/retrieval/query-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'query-cache-corrupt-evicts-file');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
const cachePath = path.join(tempRoot, 'query_cache.json');
fs.writeFileSync(cachePath, '{not-json', 'utf8');

const cache = loadQueryCache(cachePath);
assert.equal(Array.isArray(cache?.entries), true, 'expected fallback cache payload');
assert.equal(cache.entries.length, 0, 'expected empty fallback entries');
assert.equal(fs.existsSync(cachePath), false, 'expected corrupted query cache file to be removed');

console.log('query cache corrupt-evicts-file test passed');
