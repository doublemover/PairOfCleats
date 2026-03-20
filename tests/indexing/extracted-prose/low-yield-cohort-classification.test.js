#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildExtractedProseLowYieldCohort } from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

assert.equal(
  buildExtractedProseLowYieldCohort({ relPath: 'docs/readme.md', ext: '.md', pathFamily: 'docs' }).key,
  'docs-markdown'
);
assert.equal(
  buildExtractedProseLowYieldCohort({ relPath: 'tests/example.py', ext: '.py', pathFamily: 'tests' }).key,
  'tests-examples'
);
assert.equal(
  buildExtractedProseLowYieldCohort({ relPath: 'generated/schema.min.js', ext: '.js', pathFamily: 'src' }).key,
  'generated-machine'
);
assert.equal(
  buildExtractedProseLowYieldCohort({ relPath: '.github/workflows/ci.yml', ext: '.yml', pathFamily: '.github' }).key,
  'templates-config'
);

console.log('extracted prose low-yield cohort classification test passed');
