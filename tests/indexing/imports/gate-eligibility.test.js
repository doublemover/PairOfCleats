#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  filterGateEligibleImportWarnings,
  isGateEligibleImportWarning,
  normalizeExcludedImporterSegments,
  summarizeGateEligibleImportWarnings
} from '../../../src/index/build/import-resolution.js';

const warnings = [
  {
    importer: 'src\\main.ts',
    disposition: 'actionable',
    failureCause: 'missing_file'
  },
  {
    importer: 'tests\\fixtures\\sample.ts',
    disposition: 'actionable',
    failureCause: 'missing_file'
  },
  {
    importer: 'src/build.bzl',
    disposition: 'suppress_gate',
    failureCause: 'resolver_gap'
  },
  {
    importer: 'src/template.nix',
    disposition: 'suppress_live',
    failureCause: 'parser_artifact'
  }
];

const normalizedExcluded = normalizeExcludedImporterSegments(['tests', '__fixtures__']);
assert.deepEqual(
  normalizedExcluded,
  ['/tests/', '/__fixtures__/'],
  'expected normalized importer exclusion segments'
);

assert.equal(
  isGateEligibleImportWarning(
    { importer: 'tests\\unit\\case.ts' },
    normalizedExcluded
  ),
  false,
  'expected tests importer to be excluded from gate eligibility'
);
assert.equal(
  isGateEligibleImportWarning(
    { importer: 'src\\unit\\case.ts' },
    normalizedExcluded
  ),
  true,
  'expected src importer to remain gate eligible'
);

const filtered = filterGateEligibleImportWarnings(warnings, {
  excludedImporterSegments: ['tests', '__fixtures__']
});
assert.equal(filtered.length, 3, 'expected one excluded warning');

const summary = summarizeGateEligibleImportWarnings(warnings, {
  excludedImporterSegments: ['tests', '__fixtures__']
});
assert.deepEqual(
  summary,
  {
    unresolved: 3,
    actionable: 1,
    parserArtifact: 1,
    resolverGap: 1
  },
  'expected gate-eligible warning summary breakdown'
);

console.log('import resolution gate eligibility tests passed');
