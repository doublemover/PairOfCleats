#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSuiteTaxonomyReport } from './suite-taxonomy-report.js';

const report = buildSuiteTaxonomyReport({
  tests: [
    { id: 'tooling/install/detect', suiteCategory: 'hero' },
    { id: 'tooling/vscode/workspace-matrix', suiteCategory: 'matrix' },
    { id: 'tooling/config-inventory/audit', suiteCategory: 'meta' },
    { id: 'services/soak/recovery', suiteCategory: 'soak' },
    { id: 'storage/sqlite/heavy-runtime-case', suiteCategory: 'heavy-runtime' }
  ],
  manifests: new Map([
    ['ci-lite', { tests: [{}, {}], suiteCategorySummary: { hero: 1, matrix: 1, meta: 0, soak: 0, 'heavy-runtime': 0 } }],
    ['ci-long', { tests: [{}, {}], suiteCategorySummary: { hero: 0, matrix: 0, meta: 0, soak: 1, 'heavy-runtime': 1 } }]
  ]),
  ownership: {
    suites: [
      {
        id: 'lang/fixtures-sample/metadata-matrix',
        suiteCategory: 'matrix',
        coverageOwner: 'sample metadata matrix',
        replacementIds: ['lang/fixtures-sample/python-metadata'],
        overlapPolicy: 'parity',
        matrixStrategy: 'shared-search-fixture',
        processIsolationRequired: false
      }
    ]
  }
});

assert.equal(report.summary.totalTests, 5);
assert.equal(report.summary.byCategory.hero, 1);
assert.equal(report.peripheralGroups.find((entry) => entry.key === 'tooling/vscode')?.byCategory?.matrix, 1);
assert.equal(report.ownership.suites[0].replacementIds[0], 'lang/fixtures-sample/python-metadata');

console.log('suite taxonomy report test passed');
