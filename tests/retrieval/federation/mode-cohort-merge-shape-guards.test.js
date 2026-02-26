#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeFederatedResultsByMode } from '../../../src/retrieval/federation/coordinator.js';

const perRepoResults = [
  {
    repoId: 'repo-a',
    repoAlias: 'A',
    priority: 1,
    result: {
      code: [{ id: 'a-code' }],
      prose: [{ id: 'a-prose' }],
      extractedProse: [],
      records: []
    }
  }
];

const merged = mergeFederatedResultsByMode({
  perRepoResults,
  selectedReposByMode: {
    code: { repoId: 'repo-a' },
    prose: new Set([{ repoId: 'repo-a' }]),
    'extracted-prose': null
  },
  topN: 5,
  perRepoTop: 5,
  rrfK: 60
});

assert.deepEqual(merged.code, [], 'malformed selectedReposByMode entry should not throw and should produce no hits');
assert.equal(merged.prose.length, 1, 'iterable selectedReposByMode entries should be accepted');
assert.equal(merged.prose[0].repoId, 'repo-a');

console.log('federated mode cohort merge shape guard test passed');
