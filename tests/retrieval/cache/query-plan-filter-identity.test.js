#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { findQueryCacheEntry, rememberQueryCacheEntry } from '../../../src/retrieval/query-cache.js';

const plan = (match, extra = {}) => buildQueryPlan({ query: 'alpha beta', argv: { match }, dict: new Set(),
  dictConfig: {}, postingsConfig: {}, ...extra });
const key = value => buildQueryCacheKey({ query: 'alpha beta', filters: value.cacheFilters }).key;
for (const order of [['all', 'any'], ['any', 'all']]) {
  const cachePath = path.resolve('.tmp', `query-plan-policy-${process.pid}-${order.join('-')}.json`);
  const first = plan(order[0]), second = plan(order[1]);
  const firstKey = key(first), secondKey = key(second);
  assert.notEqual(first.queryAst.type, second.queryAst.type, 'the match policy changes Boolean semantics');
  assert.notEqual(firstKey, secondKey, 'different Boolean semantics select distinct persisted query identities');
  rememberQueryCacheEntry(cachePath, firstKey, 'generation', { key: firstKey, signature: 'generation', value: ['first policy only'], ts: Date.now() }, 16);
  const cacheOptions = { strategy: 'memory-first', cachePath };
  assert.ok(findQueryCacheEntry(null, firstKey, 'generation', cacheOptions), 'the first policy actually warms the production cache');
  assert.equal(findQueryCacheEntry(null, secondKey, 'generation', cacheOptions), null, 'a warm result cannot cross match-policy identities');
}
for (const field of ['branchesMin', 'loopsMin', 'breaksMin', 'continuesMin']) {
  const absent = key(plan('all'));
  const zero = key(plan('all', { [field]: 0 }));
  const one = key(plan('all', { [field]: 1 }));
  const two = key(plan('all', { [field]: 2 }));
  assert.notEqual(absent, zero, `${field}: explicit zero and absence retain distinct normalized identities`);
  assert.notEqual(zero, one, field);
  assert.notEqual(one, two, field);
  assert.equal(one, key(plan('all', { [field]: 1 })), `${field}: repeated equal thresholds reuse the same identity`);
}
console.log('Query-cache identity binds Boolean policy and all control-flow thresholds.');

for (const field of ['branchesMin', 'loopsMin', 'breaksMin', 'continuesMin']) {
  const cachePath = path.resolve('.tmp', 'query-plan-threshold-' + process.pid + '-' + field + '.json');
  const oneKey = key(plan('all', { [field]: 1 })), twoKey = key(plan('all', { [field]: 2 }));
  rememberQueryCacheEntry(cachePath, oneKey, 'threshold-generation', { key: oneKey,
    signature: 'threshold-generation', value: [{ id: 1, threshold: field }], ts: Date.now() }, 16);
  const lookup = value => findQueryCacheEntry(null, value, 'threshold-generation', { strategy: 'memory-first', cachePath });
  assert.deepEqual(lookup(oneKey).value, [{ id: 1, threshold: field }]);
  assert.deepEqual(lookup(key(plan('all', { [field]: 1 }))).value, [{ id: 1, threshold: field }]);
  assert.equal(lookup(twoKey), null, field + ': another threshold cannot borrow a repeated-query hit');
}
