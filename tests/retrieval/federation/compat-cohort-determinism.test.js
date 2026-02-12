#!/usr/bin/env node
import assert from 'node:assert/strict';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { applyCohortPolicy } from '../../../src/retrieval/federation/coordinator.js';

const reposA = [
  {
    repoId: 'repo-z',
    priority: 5,
    indexes: { code: { cohortKey: 'cohort-b', compatibilityKey: null } }
  },
  {
    repoId: 'repo-a',
    priority: 5,
    indexes: { code: { cohortKey: 'cohort-a', compatibilityKey: null } }
  }
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

assert.equal(first.modeSelections.code, 'cohort-a', 'tie should resolve lexically with null last');
assert.equal(stableStringify(first), stableStringify(second), 'cohort selection should be deterministic regardless of repo order');

console.log('federation cohort determinism test passed');
