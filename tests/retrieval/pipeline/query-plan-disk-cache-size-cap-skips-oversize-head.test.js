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
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-size-oversize-head-'));
const cachePath = path.join(tempDir, 'queryPlanCache.json');

const cache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 10,
  ttlMs: 60000,
  maxBytes: 10000
});

const makeEntry = (query, ts) => {
  const inputs = createPlanInputs({ query });
  const plan = buildTestPlan(inputs);
  const configSignature = buildPlanConfigSignature(inputs);
  const indexSignature = buildPlanIndexSignature();
  const keyInfo = buildPlanCacheKey({ query: inputs.query, configSignature, indexSignature });
  const entry = createQueryPlanEntry({
    plan,
    configSignature,
    indexSignature,
    keyPayload: keyInfo.payload
  });
  entry.ts = ts;
  return { key: keyInfo.key, entry };
};

const now = Date.now();
const small = makeEntry('small query', now - 1000);
const huge = makeEntry(`huge query ${'x'.repeat(16000)}`, now);

cache.set(small.key, small.entry);
cache.set(huge.key, huge.entry);
await cache.persist();

const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const persistedKeys = new Set((payload.entries || []).map((entry) => entry?.key));

assert.equal(
  persistedKeys.has(small.key),
  true,
  'expected cache trimming to keep smaller entries even when newest entry exceeds maxBytes'
);
assert.equal(
  persistedKeys.has(huge.key),
  false,
  'expected oversize newest entry to be skipped under size cap'
);

console.log('query plan disk cache oversize-head trimming test passed');
