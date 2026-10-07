#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  TEST_SUITE_CATEGORIES,
  buildSuiteCategorySummary,
  inferSuiteCategory
} from './suite-taxonomy.js';

assert.deepEqual(TEST_SUITE_CATEGORIES, ['hero', 'matrix', 'meta', 'soak', 'heavy-runtime']);

assert.deepEqual(
  inferSuiteCategory({ id: 'services/soak/operational-recovery', lane: 'ci-long' }),
  { category: 'soak', reason: 'services-soak-prefix' }
);
assert.deepEqual(
  inferSuiteCategory({ id: 'tooling/lsp/dedicated-provider-bootstrap-matrix', lane: 'ci-lite' }),
  { category: 'matrix', reason: 'matrix-filename' }
);
assert.deepEqual(
  inferSuiteCategory({ id: 'tooling/ci/command-surface-audit', lane: 'ci-lite' }),
  { category: 'meta', reason: 'meta-cohort-prefix' }
);
assert.deepEqual(
  inferSuiteCategory({ id: 'storage/sqlite/wal-checkpoint', lane: 'ci-long', tags: ['ci-long', 'long'] }),
  { category: 'heavy-runtime', reason: 'long-lane-or-tag' }
);
assert.deepEqual(
  inferSuiteCategory({ id: 'tooling/vscode/integration-harness', lane: 'ci-lite' }),
  { category: 'hero', reason: 'peripheral-tooling-surface' }
);

const summary = buildSuiteCategorySummary([
  { suiteCategory: 'hero' },
  { suiteCategory: 'hero' },
  { suiteCategory: 'matrix' },
  { suiteCategory: 'meta' },
  { suiteCategory: 'soak' },
  { suiteCategory: 'heavy-runtime' }
]);
assert.deepEqual(summary, {
  hero: 2,
  matrix: 1,
  meta: 1,
  soak: 1,
  'heavy-runtime': 1
});

console.log('suite taxonomy test passed');
