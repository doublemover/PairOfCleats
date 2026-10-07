#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import {
  createMixedProfileFixture,
  createMixedProfileLoadOptions
} from '../../helpers/index-compatibility-fixture.js';

applyTestEnv();

const { rootDir } = await createMixedProfileFixture('poc-vector-only-compat-mismatch-');

let failed = false;
try {
  await loadSearchIndexes(createMixedProfileLoadOptions(rootDir));
} catch (err) {
  failed = true;
  assert.match(
    String(err?.message || err),
    /compatibilityKey mismatch/i,
    'expected compatibilityKey mismatch error for mixed profile cohorts'
  );
}

if (!failed) {
  throw new Error('Expected mixed default/vector_only compatibility keys to fail by default');
}

console.log('vector-only compatibility key mismatch test passed');
