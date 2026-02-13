#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  FEDERATION_COHORT_ERRORS
} from '../../../src/retrieval/federation/cohorts.js';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';

const repos = [
  {
    repoId: 'repo-a',
    priority: 1,
    indexes: {
      code: { cohortKey: 'code-a', compatibilityKey: null },
      prose: { cohortKey: 'prose-a', compatibilityKey: null }
    }
  },
  {
    repoId: 'repo-b',
    priority: 1,
    indexes: {
      code: { cohortKey: 'code-b', compatibilityKey: null },
      prose: { cohortKey: 'prose-b', compatibilityKey: null }
    }
  }
];

const selected = applyCohortPolicy({
  repos,
  modes: ['code', 'prose'],
  cohort: ['code:code-b'],
  policy: 'default'
});

assert.deepEqual(
  selected.selectedReposByMode.code.map((entry) => entry.repoId),
  ['repo-b'],
  'mode-specific cohort selector should pin code mode selection'
);
assert.ok(selected.selectedReposByMode.prose.length > 0, 'other modes should still use default cohort policy');

assert.throws(() => applyCohortPolicy({
  repos,
  modes: ['code'],
  cohort: ['missing-cohort'],
  policy: 'default'
}), (error) => {
  assert.equal(error.code, FEDERATION_COHORT_ERRORS.COHORT_NOT_FOUND);
  return true;
});

console.log('federation cohort explicit selection test passed');
