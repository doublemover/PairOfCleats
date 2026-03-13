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
} from '../pipeline/query-plan-helpers.js';

const cache = createQueryPlanCache({ maxEntries: 2, ttlMs: 1000 });

const makeEntry = (query) => {
  const inputs = createPlanInputs({ query });
  const plan = buildTestPlan(inputs);
  const configSignature = buildPlanConfigSignature(inputs);
  const indexSignature = buildPlanIndexSignature({ code: `sig:${query}` });
  const key = buildPlanCacheKey({ query, configSignature, indexSignature });
  const entry = createQueryPlanEntry({
    plan,
    configSignature,
    indexSignature,
    keyPayload: key.payload
  });
  return { key: key.key, configSignature, indexSignature, entry };
};

const a = makeEntry('alpha');
const b = makeEntry('beta');
const c = makeEntry('gamma');

cache.set(a.key, a.entry);
cache.set(b.key, b.entry);
cache.set(c.key, c.entry);
assert.ok(cache.size() <= 2, 'expected query-plan cache to honor maxEntries bound');
assert.equal(cache.get(a.key, { configSignature: a.configSignature, indexSignature: a.indexSignature }), null);
assert.ok(cache.get(b.key, { configSignature: b.configSignature, indexSignature: b.indexSignature }));
assert.ok(cache.get(c.key, { configSignature: c.configSignature, indexSignature: c.indexSignature }));

console.log('query plan cache bounds test passed');
