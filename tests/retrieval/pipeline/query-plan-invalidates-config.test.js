#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createQueryPlanCache,
  createQueryPlanEntry
} from '../../../src/retrieval/query-plan-cache.js';
import {
  buildPlanCacheKey,
  buildPlanConfigSignature,
  buildPlanIndexSignature,
  buildTestPlan,
  createPlanInputs
} from './query-plan-helpers.js';

process.env.PAIROFCLEATS_TESTING = '1';

const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60000 });
const inputs = createPlanInputs();
const plan = buildTestPlan(inputs);
const configSignature = buildPlanConfigSignature(inputs);
const indexSignature = buildPlanIndexSignature();
const keyInfo = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature
});

cache.resetIfConfigChanged(configSignature);
cache.set(
  keyInfo.key,
  createQueryPlanEntry({
    plan,
    configSignature,
    indexSignature,
    keyPayload: keyInfo.payload
  })
);

const nextConfigSignature = `${configSignature}-changed`;
cache.resetIfConfigChanged(nextConfigSignature);

const cached = cache.get(keyInfo.key, { configSignature, indexSignature });
assert.equal(cached, null, 'expected cache miss after config change');

console.log('query plan cache invalidates on config change test passed');
