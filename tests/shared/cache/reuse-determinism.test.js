#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import { buildMapCacheKey } from '../../../src/map/build-map.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { buildQueryPlanCacheKey } from '../../../src/retrieval/query-plan-cache.js';

const graphKeyA = buildGraphIndexCacheKey({
  indexSignature: 'sig',
  repoRoot: '/repo',
  graphs: ['usage', 'call'],
  includeCsr: true
});
const graphKeyB = buildGraphIndexCacheKey({
  indexSignature: 'sig',
  repoRoot: '/repo',
  graphs: ['call', 'usage'],
  includeCsr: true
});
assert.equal(graphKeyA, graphKeyB, 'graph cache key should be order-independent');

const mapKeyA = buildMapCacheKey({
  buildId: 'build-1',
  options: { scope: 'repo', focus: null, include: ['src'], onlyExported: true }
});
const mapKeyB = buildMapCacheKey({
  buildId: 'build-1',
  options: { include: ['src'], onlyExported: true, focus: null, scope: 'repo' }
});
assert.equal(mapKeyA, mapKeyB, 'map cache key should be deterministic');

const queryKeyA = buildQueryCacheKey({ query: 'foo', filters: ['a', 'b'] });
const queryKeyB = buildQueryCacheKey({ filters: ['a', 'b'], query: 'foo' });
assert.equal(queryKeyA.key, queryKeyB.key, 'query cache key should be deterministic');

const planKeyA = buildQueryPlanCacheKey({
  query: 'foo',
  configSignature: 'cfg',
  indexSignature: 'idx'
});
const planKeyB = buildQueryPlanCacheKey({
  query: 'foo',
  configSignature: 'cfg',
  indexSignature: 'idx'
});
assert.equal(planKeyA.key, planKeyB.key, 'query plan cache key should be deterministic');

console.log('cache reuse determinism tests passed');
