#!/usr/bin/env node
import assert from 'node:assert/strict';
import { FEDERATION_COHORT_WARNINGS } from '../../../src/retrieval/federation/cohorts.js';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';

const makeRepo = (repoId, priority, modeKey) => ({
  repoId,
  priority,
  indexes: {
    code: {
      cohortKey: modeKey,
      compatibilityKey: `${modeKey}-compat`
    }
  }
});

const repos = [
  makeRepo('repo-a', 10, 'cohort-a'),
  makeRepo('repo-b', 5, 'cohort-a'),
  makeRepo('repo-c', 100, 'cohort-b')
];

const result = applyCohortPolicy({
  repos,
  modes: ['code'],
  policy: 'default'
});

assert.equal(result.modeSelections.code, 'cohort-a', 'default policy should pick the largest cohort');
assert.deepEqual(
  result.selectedReposByMode.code.map((entry) => entry.repoId),
  ['repo-a', 'repo-b']
);
assert.deepEqual(
  result.excluded.code.map((entry) => entry.repoId),
  ['repo-c']
);
assert.ok(
  result.warnings.includes(FEDERATION_COHORT_WARNINGS.MULTI_COHORT),
  'default policy should emit multi-cohort warning when cohorts are excluded'
);

console.log('federation cohort defaults test passed');
