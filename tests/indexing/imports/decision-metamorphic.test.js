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

assert.equal(windowsVariant.category, 'unknown');
assert.equal(redundantSegmentVariant.category, 'unknown');
assert.equal(windowsVariant.reasonCode, 'IMP_U_UNKNOWN');
assert.equal(redundantSegmentVariant.reasonCode, 'IMP_U_UNKNOWN');
assert.equal(normalizedVariant.category, 'unknown');

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

const parseReasonVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reason: 'parse_error'
});
assert.equal(parseReasonVariant.reasonCode, 'IMP_U_PARSE_ERROR');
assert.equal(parseReasonVariant.category, 'parse_error');

console.log('import resolution decision metamorphic test passed');
