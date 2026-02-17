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

const cache = createQueryPlanCache({ maxEntries: 1, ttlMs: 60000 });

const inputsA = createPlanInputs({ query: 'alpha' });
const planA = buildTestPlan(inputsA);
const configA = buildPlanConfigSignature(inputsA);
const indexA = buildPlanIndexSignature({ backend: 'memory', code: 'sig-a' });
const keyA = buildPlanCacheKey({ query: inputsA.query, configSignature: configA, indexSignature: indexA });

cache.set(
  keyA.key,
  createQueryPlanEntry({
    plan: planA,
    configSignature: configA,
    indexSignature: indexA,
    keyPayload: keyA.payload
  })
);

const inputsB = createPlanInputs({ query: 'beta' });
const planB = buildTestPlan(inputsB);
const configB = buildPlanConfigSignature(inputsB);
const indexB = buildPlanIndexSignature({ backend: 'memory', code: 'sig-b' });
const keyB = buildPlanCacheKey({ query: inputsB.query, configSignature: configB, indexSignature: indexB });

cache.set(
  keyB.key,
  createQueryPlanEntry({
    plan: planB,
    configSignature: configB,
    indexSignature: indexB,
    keyPayload: keyB.payload
  })
);

const evicted = cache.get(keyA.key, { configSignature: configA, indexSignature: indexA });
assert.equal(evicted, null, 'expected first entry to be evicted');

const retained = cache.get(keyB.key, { configSignature: configB, indexSignature: indexB });
assert.ok(retained, 'expected second entry to remain');

console.log('query plan cache eviction test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
