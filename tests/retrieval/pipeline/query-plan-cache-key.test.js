#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildPlanCacheKey,
  buildPlanConfigSignature,
  buildPlanIndexSignature,
  createPlanInputs
} from './query-plan-helpers.js';

applyTestEnv();

const inputs = createPlanInputs();
const configSignature = buildPlanConfigSignature(inputs);
const indexSignature = buildPlanIndexSignature();
const keyInfo = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature
});

const sameKeyInfo = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature
});
assert.equal(keyInfo.key, sameKeyInfo.key, 'expected stable key for same inputs');

const differentQueryKey = buildPlanCacheKey({
  query: `${inputs.query} extra`,
  configSignature,
  indexSignature
});
assert.notEqual(keyInfo.key, differentQueryKey.key, 'expected different key for different query');

const otherConfigSignature = `${configSignature}-alt`;
const differentConfigKey = buildPlanCacheKey({
  query: inputs.query,
  configSignature: otherConfigSignature,
  indexSignature
});
assert.notEqual(keyInfo.key, differentConfigKey.key, 'expected different key for different config');

const otherIndexSignature = buildPlanIndexSignature({ backend: 'memory', code: 'sig-alt' });
const differentIndexKey = buildPlanCacheKey({
  query: inputs.query,
  configSignature,
  indexSignature: otherIndexSignature
});
assert.notEqual(keyInfo.key, differentIndexKey.key, 'expected different key for different index signature');

console.log('query plan cache key test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
