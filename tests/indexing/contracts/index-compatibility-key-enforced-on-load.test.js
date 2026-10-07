#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import {
  createCompatibilityIndexFixture,
  createLoadSearchIndexesMemoryOptions
} from '../../helpers/index-compatibility-fixture.js';

applyTestEnv();

const { rootDir } = await createCompatibilityIndexFixture('poc-compat-load-', [
  { mode: 'code', compatibilityKey: 'compat-code', fileName: 'src/a.js' },
  { mode: 'prose', compatibilityKey: 'compat-prose', fileName: 'src/a.js' }
]);

let failed = false;
try {
  await loadSearchIndexes(createLoadSearchIndexesMemoryOptions(rootDir));
} catch (err) {
  failed = true;
  assert.match(
    String(err?.message || err),
    /compatibilityKey mismatch/i,
    'expected compatibilityKey mismatch error'
  );
}

if (!failed) {
  throw new Error('Expected loadSearchIndexes to reject mismatched compatibilityKey values');
}

console.log('compatibility key enforced on load test passed');
