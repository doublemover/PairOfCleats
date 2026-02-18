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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-size-'));
const cachePath = path.join(tempDir, 'queryPlanCache.json');
const maxBytes = 1500;

const cache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 10,
  ttlMs: 60000,
  maxBytes
});

cache.load();

for (let i = 0; i < 8; i += 1) {
  const inputs = createPlanInputs({ query: `alpha beta ${'x'.repeat(i * 40)}` });
  const plan = buildTestPlan(inputs);
  const configSignature = buildPlanConfigSignature(inputs);
  const indexSignature = buildPlanIndexSignature();
  const keyInfo = buildPlanCacheKey({ query: inputs.query, configSignature, indexSignature });
  cache.set(
    keyInfo.key,
    createQueryPlanEntry({
      plan,
      configSignature,
      indexSignature,
      keyPayload: keyInfo.payload
    })
  );
}

cache.persist();

const stats = fs.statSync(cachePath);
assert.ok(stats.size <= maxBytes, `expected cache size <= ${maxBytes}, got ${stats.size}`);

const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
assert.ok(Array.isArray(payload.entries), 'expected disk cache entries list');
assert.ok(payload.entries.length <= 8, 'expected cache entries to be trimmed');

console.log('query plan disk cache size cap test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
