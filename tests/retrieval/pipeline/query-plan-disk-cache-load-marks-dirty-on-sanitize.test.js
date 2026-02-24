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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-query-plan-load-dirty-'));
const cachePath = path.join(tempDir, 'queryPlanCache.json');

const inputs = createPlanInputs({ query: 'valid cache query' });
const plan = buildTestPlan(inputs);
const configSignature = buildPlanConfigSignature(inputs);
const indexSignature = buildPlanIndexSignature();
const keyInfo = buildPlanCacheKey({ query: inputs.query, configSignature, indexSignature });
const validEntry = createQueryPlanEntry({
  plan,
  configSignature,
  indexSignature,
  keyPayload: keyInfo.payload
});

const seedCache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 8,
  ttlMs: 60000,
  maxBytes: 1024 * 1024
});
seedCache.set(keyInfo.key, validEntry);
await seedCache.persist();

const diskPayload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
diskPayload.entries.push({
  key: 'invalid-entry',
  entry: {
    ts: Date.now(),
    configSignature,
    indexSignature,
    keyPayload: keyInfo.payload,
    plan: null
  }
});
fs.writeFileSync(cachePath, JSON.stringify(diskPayload), 'utf8');

const cache = createQueryPlanDiskCache({
  path: cachePath,
  maxEntries: 8,
  ttlMs: 60000,
  maxBytes: 1024 * 1024
});

const loaded = cache.load();
assert.equal(loaded, 1, 'expected one valid entry to load');
assert.equal(cache.isDirty(), true, 'expected load sanitization to mark disk cache dirty');

await cache.persist();
const sanitized = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
assert.equal((sanitized.entries || []).length, 1, 'expected persist to rewrite sanitized entry list');

console.log('query plan disk cache load dirty-on-sanitize test passed');
