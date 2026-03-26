#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  FEDERATION_COHORT_ERRORS,
  FEDERATION_COHORT_WARNINGS
} from '../../../src/retrieval/federation/cohorts.js';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const makeRepo = (repoId, priority, modes) => ({
  repoId,
  priority,
  indexes: { ...modes }
});

const cases = [
  {
    name: 'default policy picks the largest available cohort and warns on exclusions',
    run() {
      const repos = [
        makeRepo('repo-a', 10, {
          code: { cohortKey: 'cohort-a', compatibilityKey: 'compat-a' }
        }),
        makeRepo('repo-b', 5, {
          code: { cohortKey: 'cohort-a', compatibilityKey: 'compat-a' }
        }),
        makeRepo('repo-c', 100, {
          code: { cohortKey: 'cohort-b', compatibilityKey: 'compat-b' }
        })
      ];

      const result = applyCohortPolicy({
        repos,
        modes: ['code'],
        policy: 'default'
      });

      assert.equal(result.modeSelections.code, 'cohort-a');
      assert.deepEqual(
        result.selectedReposByMode.code.map((entry) => entry.repoId),
        ['repo-a', 'repo-b']
      );
      assert.deepEqual(
        result.excluded.code.map((entry) => entry.repoId),
        ['repo-c']
      );
      assert.ok(result.warnings.includes(FEDERATION_COHORT_WARNINGS.MULTI_COHORT));
    }
  },
  {
    name: 'availability filtering keeps per-mode cohorts independent',
    run() {
      const repos = [
        makeRepo('repo-code', 1, {
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
        }),
        makeRepo('repo-prose', 1, {
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
        }),
        makeRepo('repo-unavailable', 10, {
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
        })
      ];

      const result = applyCohortPolicy({
        repos,
        modes: ['code', 'prose'],
        policy: 'default'
      });

      assert.equal(result.modeSelections.code, 'code-cohort');
      assert.equal(result.modeSelections.prose, 'prose-cohort');
      assert.deepEqual(result.selectedReposByMode.code.map((entry) => entry.repoId), ['repo-code']);
      assert.deepEqual(result.selectedReposByMode.prose.map((entry) => entry.repoId), ['repo-prose']);
    }
  },
  {
    name: 'explicit selectors pin one mode while other modes use defaults',
    run() {
      const repos = [
        makeRepo('repo-a', 1, {
          code: { cohortKey: 'code-a', compatibilityKey: null },
          prose: { cohortKey: 'prose-a', compatibilityKey: null }
        }),
        makeRepo('repo-b', 1, {
          code: { cohortKey: 'code-b', compatibilityKey: null },
          prose: { cohortKey: 'prose-b', compatibilityKey: null }
        })
      ];

      const selected = applyCohortPolicy({
        repos,
        modes: ['code', 'prose'],
        cohort: ['code:code-b'],
        policy: 'default'
      });

      assert.deepEqual(
        selected.selectedReposByMode.code.map((entry) => entry.repoId),
        ['repo-b']
      );
      assert.ok(selected.selectedReposByMode.prose.length > 0);

      assert.throws(() => applyCohortPolicy({
        repos,
        modes: ['code'],
        cohort: ['missing-cohort'],
        policy: 'default'
      }), (error) => {
        assert.equal(error.code, FEDERATION_COHORT_ERRORS.COHORT_NOT_FOUND);
        return true;
      });
    }
  },
  {
    name: 'ties resolve deterministically regardless of repo order',
    run() {
      const reposA = [
        makeRepo('repo-z', 5, {
          code: { cohortKey: 'cohort-b', compatibilityKey: null }
        }),
        makeRepo('repo-a', 5, {
          code: { cohortKey: 'cohort-a', compatibilityKey: null }
        })
      ];
      const reposB = [...reposA].reverse();

      const first = applyCohortPolicy({
        repos: reposA,
        modes: ['code'],
        policy: 'default'
      });
      const second = applyCohortPolicy({
        repos: reposB,
        modes: ['code'],
        policy: 'default'
      });

      assert.equal(first.modeSelections.code, 'cohort-a');
      assert.equal(stableStringify(first), stableStringify(second));
    }
  },
  {
    name: 'all unavailable repos keep mode selection empty',
    run() {
      const repos = [
        makeRepo('repo-a', 10, {
          code: {
            cohortKey: 'cohort-a',
            compatibilityKey: 'compat-a',
            present: false,
            availabilityReason: 'missing-index-dir'
          }
        }),
        makeRepo('repo-b', 5, {
          code: {
            cohortKey: 'cohort-b',
            compatibilityKey: 'compat-b',
            present: false,
            availabilityReason: 'missing-index-dir'
          }
        })
      ];

      const selected = applyCohortPolicy({
        repos,
        modes: ['code'],
        policy: 'default'
      });

      assert.equal(selected.modeSelections.code, null);
      assert.deepEqual(selected.selectedReposByMode.code, []);
      assert.deepEqual(selected.excluded.code, []);
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('federation cohort policy matrix test passed');
