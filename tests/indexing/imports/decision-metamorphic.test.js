#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyUnresolvedImportSample } from '../../../src/index/build/imports.js';

const windowsVariant = classifyUnresolvedImportSample({
  importer: 'src\\main.js',
  specifier: '.\\foo\\bar.js',
  reason: 'missing'
});
const redundantSegmentVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/./bar.js',
  reason: 'missing'
});
const normalizedVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reason: 'missing'
});

assert.equal(windowsVariant.category, 'path_normalization');
assert.equal(redundantSegmentVariant.category, 'path_normalization');
assert.equal(windowsVariant.reasonCode, 'IMP_U_PATH_NORMALIZATION');
assert.equal(redundantSegmentVariant.reasonCode, 'IMP_U_PATH_NORMALIZATION');
assert.equal(normalizedVariant.category, 'missing_file');

const explicitReasonCodeA = classifyUnresolvedImportSample({
  importer: 'src\\main.js',
  specifier: '.\\foo\\bar.js',
  reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
  failureCause: 'missing_file',
  disposition: 'actionable',
  resolverStage: 'filesystem_probe'
});
const explicitReasonCodeB = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
  failureCause: 'missing_file',
  disposition: 'actionable',
  resolverStage: 'filesystem_probe'
});

assert.equal(explicitReasonCodeA.reasonCode, explicitReasonCodeB.reasonCode);
assert.equal(explicitReasonCodeA.failureCause, explicitReasonCodeB.failureCause);
assert.equal(explicitReasonCodeA.disposition, explicitReasonCodeB.disposition);
assert.equal(explicitReasonCodeA.resolverStage, explicitReasonCodeB.resolverStage);

console.log('import resolution decision metamorphic test passed');
