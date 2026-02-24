#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createQueryPlanDiskCache,
  createQueryPlanEntry
} from '../../../src/retrieval/query-plan-cache.js';
import {
  buildPlanCacheKey,
  buildPlanConfigSignature,
  buildPlanIndexSignature,
  buildTestPlan,
  createPlanInputs
} from './query-plan-helpers.js';

applyTestEnv();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-'));
const cachePath = path.join(tempDir, 'queryPlanCache.json');

const inputs = createPlanInputs({ query: 'alpha beta' });
const plan = buildTestPlan(inputs);
const configSignature = buildPlanConfigSignature(inputs);
const indexSignature = buildPlanIndexSignature();
const keyInfo = buildPlanCacheKey({ query: inputs.query, configSignature, indexSignature });

const cache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 5,
  ttlMs: 60000,
  maxBytes: 1024 * 1024
});

cache.load();
cache.set(
  keyInfo.key,
  createQueryPlanEntry({
    plan,
    configSignature,
    indexSignature,
    keyPayload: keyInfo.payload
  })
);
await cache.persist();

assert.ok(fs.existsSync(cachePath), 'expected disk cache file to be written');

const freshCache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 5,
  ttlMs: 60000,
  maxBytes: 1024 * 1024
});

freshCache.load();
const cached = freshCache.get(keyInfo.key, { configSignature, indexSignature });
assert.ok(cached, 'expected disk cache hit');
assert.ok(Array.isArray(cached.plan.queryTokens), 'expected cached plan tokens');
assert.ok(cached.plan.highlightRegex instanceof RegExp, 'expected highlight regex to be hydrated');
assert.ok(
  cached.plan.phraseNgramSet == null || cached.plan.phraseNgramSet instanceof Set,
  'expected phraseNgramSet to be hydrated'
);

console.log('query plan disk cache test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
