#!/usr/bin/env node
import assert from 'node:assert/strict';
import { stableStringify } from '../../../src/shared/stable-json.js';
import {
  buildFederatedQueryCacheKey,
  buildFederatedQueryCacheKeyPayload
} from '../../../src/retrieval/federation/query-cache.js';

const payloadA = buildFederatedQueryCacheKeyPayload({
  repoSetId: 'ws1-demo',
  manifestHash: 'wm1-alpha',
  query: 'greet',
  selection: {
    selectedRepoIds: ['repo-b', 'repo-a'],
    includeDisabled: false,
    tags: ['service', 'api'],
    repoFilter: ['repo-*', 'svc-*'],
    explicitSelects: ['repo-b', 'repo-a']
  },
  cohorts: {
    policy: 'default',
    modeSelections: { code: 'cohort-a', prose: 'cohort-a' },
    excluded: {
      code: [{ repoId: 'repo-c', effectiveKey: 'cohort-b', reason: 'cohort-excluded' }]
    }
  },
  cohortSelectors: ['code:cohort-a'],
  search: {
    mode: 'code',
    top: 10,
    backend: 'auto'
  },
  merge: {
    strategy: 'rrf',
    rrfK: 60
  },
  limits: {
    top: 10,
    perRepoTop: 20,
    concurrency: 4
  },
  runtime: {
    perRepoArgs: ['--json', '--compact', '--top', '20'],
    requestedBackend: 'auto'
  }
});

const payloadB = buildFederatedQueryCacheKeyPayload({
  repoSetId: 'ws1-demo',
  manifestHash: 'wm1-alpha',
  query: 'greet',
  selection: {
    selectedRepoIds: ['repo-a', 'repo-b'],
    includeDisabled: false,
    tags: ['api', 'service'],
    repoFilter: ['svc-*', 'repo-*'],
    explicitSelects: ['repo-a', 'repo-b']
  },
  cohorts: {
    policy: 'default',
    modeSelections: { prose: 'cohort-a', code: 'cohort-a' },
    excluded: {
      code: [{ reason: 'cohort-excluded', effectiveKey: 'cohort-b', repoId: 'repo-c' }]
    }
  },
  cohortSelectors: ['code:cohort-a'],
  search: {
    backend: 'auto',
    top: 10,
    mode: 'code'
  },
  merge: {
    rrfK: 60,
    strategy: 'rrf'
  },
  limits: {
    concurrency: 4,
    perRepoTop: 20,
    top: 10
  },
  runtime: {
    requestedBackend: 'auto',
    perRepoArgs: ['--json', '--compact', '--top', '20']
  }
});

const keyA = buildFederatedQueryCacheKey(payloadA);
const keyB = buildFederatedQueryCacheKey(payloadB);

assert.equal(stableStringify(payloadA), stableStringify(payloadB), 'normalized key payload should be byte-stable');
assert.equal(keyA.keyHash, keyB.keyHash, 'equivalent payloads should generate identical cache keys');
assert.equal(keyA.keyPayloadHash, keyB.keyPayloadHash, 'equivalent payloads should generate identical payload hashes');

console.log('federated query cache key stability test passed');
