#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mergeImportGraphWarnings } from '../../../src/index/build/indexer/steps/relations/import-scan.js';

const existingWarnings = [
  {
    importer: 'src/main.js',
    specifier: './missing.js',
    reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
    reason: 'missing file',
    source: 'graph'
  },
  {
    importer: 'src/legacy.js',
    specifier: 'legacy-pkg',
    reasonCode: 'IMP_U_UNKNOWN',
    reason: 'legacy unresolved',
    source: 'graph'
  }
];

const unresolvedSamples = [
  {
    importer: 'src/main.js',
    specifier: './missing.js',
    reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
    reason: 'missing file',
    source: 'scan'
  },
  {
    importer: 'src/extra.js',
    specifier: './missing2.js',
    reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
    reason: 'missing file',
    source: 'scan'
  }
];

const mergedWarnings = mergeImportGraphWarnings({
  existingWarnings,
  unresolvedSamples
});

assert.equal(mergedWarnings.length, 3);
assert.deepEqual(
  mergedWarnings.map((warning) => warning.importer),
  ['src/main.js', 'src/legacy.js', 'src/extra.js']
);
assert.equal(mergedWarnings[0].source, 'graph');
assert.equal(mergedWarnings[2].source, 'scan');
assert.notStrictEqual(mergedWarnings[0], existingWarnings[0]);
assert.notStrictEqual(mergedWarnings[2], unresolvedSamples[1]);

existingWarnings[0].reason = 'mutated';
assert.equal(mergedWarnings[0].reason, 'missing file');

const mergedWithMissingExisting = mergeImportGraphWarnings({
  existingWarnings: null,
  unresolvedSamples: [
    unresolvedSamples[0],
    unresolvedSamples[0],
    null,
    'noise',
    unresolvedSamples[1]
  ]
});
assert.equal(mergedWithMissingExisting.length, 2);
assert.deepEqual(
  mergedWithMissingExisting.map((warning) => warning.importer),
  ['src/main.js', 'src/extra.js']
);

const mergedPreservesExistingOnDuplicate = mergeImportGraphWarnings({
  existingWarnings: [existingWarnings[1]],
  unresolvedSamples: [
    {
      importer: 'src/legacy.js',
      specifier: 'legacy-pkg',
      reasonCode: 'IMP_U_UNKNOWN',
      reason: 'different unresolved reason text',
      source: 'scan'
    }
  ]
});
assert.equal(mergedPreservesExistingOnDuplicate.length, 2);
assert.equal(mergedPreservesExistingOnDuplicate[0].source, 'graph');
assert.equal(mergedPreservesExistingOnDuplicate[1].source, 'scan');

console.log('import graph warning merge test passed');
