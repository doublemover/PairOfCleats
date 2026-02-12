#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeFederatedResultsByMode } from '../../../src/retrieval/federation/coordinator.js';

const perRepoResults = [
  {
    repoId: 'repo-high',
    repoAlias: 'high',
    priority: 100,
    result: {
      code: [{ id: 'high-code', file: 'src/high.js', start: 1, end: 1, score: 1 }],
      prose: [{ id: 'high-prose', file: 'docs/high.md', start: 1, end: 1, score: 1 }],
      extractedProse: [],
      records: []
    }
  },
  {
    repoId: 'repo-low',
    repoAlias: 'low',
    priority: 1,
    result: {
      code: [{ id: 'low-code', file: 'src/low.js', start: 1, end: 1, score: 1 }],
      prose: [{ id: 'low-prose', file: 'docs/low.md', start: 1, end: 1, score: 1 }],
      extractedProse: [],
      records: []
    }
  }
];

const selectedReposByMode = {
  code: [{ repoId: 'repo-low' }],
  prose: [{ repoId: 'repo-high' }],
  'extracted-prose': [],
  records: []
};

const merged = mergeFederatedResultsByMode({
  perRepoResults,
  selectedReposByMode,
  topN: 1,
  perRepoTop: 10,
  rrfK: 60
});

assert.deepEqual(merged.code.map((hit) => hit.repoId), ['repo-low']);
assert.deepEqual(merged.prose.map((hit) => hit.repoId), ['repo-high']);
assert.deepEqual(merged.extractedProse, []);
assert.deepEqual(merged.records, []);

console.log('federation mode cohort merge cutoff ordering test passed');
