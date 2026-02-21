#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { SKIP_GLOBS } from '../../../src/index/constants.js';

applyTestEnv();

const requiredPatterns = [
  '**/*.d.ts',
  '**/*.d.mts',
  '**/*.d.cts',
  '**/*.d.ts.map',
  '**/*.d.mts.map',
  '**/*.d.cts.map'
];

for (const pattern of requiredPatterns) {
  assert.equal(SKIP_GLOBS.has(pattern), true, `missing TypeScript declaration skip glob: ${pattern}`);
}

console.log('typescript declaration skip-glob policy test passed');
