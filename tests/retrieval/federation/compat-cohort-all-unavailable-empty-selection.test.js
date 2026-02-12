#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';

const repos = [
  {
    repoId: 'repo-a',
    priority: 10,
    indexes: {
      code: {
        cohortKey: 'cohort-a',
        compatibilityKey: 'compat-a',
        present: false,
        availabilityReason: 'missing-index-dir'
      }
    }
  },
  {
    repoId: 'repo-b',
    priority: 5,
    indexes: {
      code: {
        cohortKey: 'cohort-b',
        compatibilityKey: 'compat-b',
        present: false,
        availabilityReason: 'missing-index-dir'
      }
    }
  }
];

const selected = applyCohortPolicy({
  repos,
  modes: ['code'],
  policy: 'default'
});

assert.equal(selected.modeSelections.code, null);
assert.deepEqual(
  selected.selectedReposByMode.code,
  [],
  'all-unavailable repos should remain excluded for that mode'
);
assert.deepEqual(
  selected.excluded.code,
  [],
  'no cohorts should be selected or excluded when every repo is unavailable'
);

console.log('federation cohort all-unavailable selection test passed');
