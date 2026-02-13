#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';

const repos = [
  {
    repoId: 'repo-code',
    priority: 1,
    indexes: {
      code: {
        cohortKey: 'code-cohort',
        compatibilityKey: 'code-compat',
        present: true,
        availabilityReason: 'present'
      },
      prose: {
        cohortKey: null,
        compatibilityKey: null,
        present: false,
        availabilityReason: 'missing-index-dir'
      }
    }
  },
  {
    repoId: 'repo-prose',
    priority: 1,
    indexes: {
      code: {
        cohortKey: null,
        compatibilityKey: null,
        present: false,
        availabilityReason: 'missing-index-dir'
      },
      prose: {
        cohortKey: 'prose-cohort',
        compatibilityKey: 'prose-compat',
        present: true,
        availabilityReason: 'present'
      }
    }
  },
  {
    repoId: 'repo-unavailable',
    priority: 10,
    indexes: {
      code: {
        cohortKey: null,
        compatibilityKey: null,
        present: false,
        availabilityReason: 'missing-index-dir'
      },
      prose: {
        cohortKey: null,
        compatibilityKey: null,
        present: false,
        availabilityReason: 'missing-index-dir'
      }
    }
  }
];

const selected = applyCohortPolicy({
  repos,
  modes: ['code', 'prose'],
  policy: 'default'
});

assert.equal(selected.modeSelections.code, 'code-cohort');
assert.equal(selected.modeSelections.prose, 'prose-cohort');
assert.deepEqual(
  selected.selectedReposByMode.code.map((entry) => entry.repoId),
  ['repo-code'],
  'code mode should ignore repos unavailable for code'
);
assert.deepEqual(
  selected.selectedReposByMode.prose.map((entry) => entry.repoId),
  ['repo-prose'],
  'prose mode should ignore repos unavailable for prose'
);

console.log('federation cohort availability filtering test passed');
