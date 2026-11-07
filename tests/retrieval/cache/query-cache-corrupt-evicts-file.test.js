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

const warnings = [];
const onWarning = warning => warnings.push(warning);
process.on('warning', onWarning);
const cache = loadQueryCache(cachePath);
assert.equal(Array.isArray(cache?.entries), true, 'expected fallback cache payload');
assert.equal(cache.entries.length, 0, 'expected empty fallback entries');
assert.equal(fs.existsSync(cachePath), false, 'expected corrupted query cache file to be removed');
await new Promise(resolve => setImmediate(resolve));
process.off('warning', onWarning);
assert.deepEqual(warnings.map(warning => warning.code), ['QUERY_CACHE_WARNING', 'QUERY_CACHE_WARNING']);
assert.ok(warnings.some(warning => warning.message.includes('ERR_QUERY_CACHE_READ')),
  'the corrupt-input warning identifies the read/parse failure');
assert.ok(warnings.some(warning => warning.message.includes('quarantined corrupt query cache')),
  'the quarantine warning accompanies actual corrupt-file eviction');

console.log('query cache corrupt-evicts-file test passed');
