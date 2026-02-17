#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveProfileCohortModes } from '../../../src/retrieval/cli.js';

const optionalExtracted = resolveProfileCohortModes({
  runCode: true,
  runProse: false,
  runRecords: false,
  requiresExtractedProse: false
});
assert.deepEqual(
  optionalExtracted,
  ['code'],
  'optional extracted-prose should be excluded from profile cohort checks'
);

const requiredExtracted = resolveProfileCohortModes({
  runCode: false,
  runProse: false,
  runRecords: false,
  requiresExtractedProse: true
});
assert.deepEqual(
  requiredExtracted,
  ['extracted-prose'],
  'explicit extracted-prose mode should be included in profile cohort checks'
);

const mixedPrimaryModes = resolveProfileCohortModes({
  runCode: true,
  runProse: true,
  runRecords: true,
  requiresExtractedProse: false
});
assert.deepEqual(
  mixedPrimaryModes,
  ['code', 'prose', 'records'],
  'primary modes should remain in cohort checks when extracted-prose is optional'
);

console.log('cli profile cohort mode selection test passed');
