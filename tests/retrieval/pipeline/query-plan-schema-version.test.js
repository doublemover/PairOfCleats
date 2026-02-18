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
const indexSignature = buildPlanIndexSignature();
const keyInfo = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature
});

const entry = createQueryPlanEntry({
  plan,
  configSignature,
  indexSignature,
  keyPayload: keyInfo.payload
});
entry.schemaVersion = 0;

cache.set(keyInfo.key, entry);

const cached = cache.get(keyInfo.key, { configSignature, indexSignature });
assert.equal(cached, null, 'expected schema version mismatch to invalidate cache');

console.log('query plan schema version test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
