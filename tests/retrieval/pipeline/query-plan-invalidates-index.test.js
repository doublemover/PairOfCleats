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

applyTestEnv();

const cache = createQueryPlanCache({ maxEntries: 5, ttlMs: 60000 });
const inputs = createPlanInputs();
const plan = buildTestPlan(inputs);
const configSignature = buildPlanConfigSignature(inputs);
const indexSignature = buildPlanIndexSignature({ backend: 'memory', code: 'sig-a' });
const keyInfo = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature
});

cache.set(
  keyInfo.key,
  createQueryPlanEntry({
    plan,
    configSignature,
    indexSignature,
    keyPayload: keyInfo.payload
  })
);

const differentIndexSignature = buildPlanIndexSignature({ backend: 'memory', code: 'sig-b' });
const cached = cache.get(keyInfo.key, {
  configSignature,
  indexSignature: differentIndexSignature
});
assert.equal(cached, null, 'expected cache miss when index signature changes');

console.log('query plan cache invalidates on index signature test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
