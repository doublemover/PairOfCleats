#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  assertOptionalExtractedProseDisabled,
  createOptionalExtractedProseRoot,
  loadOptionalExtractedProseIndexesWithWarnings,
  writeOptionalExtractedProseIndexPair
} from './helpers/optional-extracted-prose-index-fixture.js';

applyTestEnv();

const rootDir = await createOptionalExtractedProseRoot('poc-optional-extracted-strict-compat-mismatch-');

await writeOptionalExtractedProseIndexPair(rootDir, {
  codeCompatibilityKey: 'compat-cohort-a',
  extractedProseCompatibilityKey: 'compat-cohort-b',
  codeChunkMeta: [{ id: 0, file: 'src/a.js', start: 0, end: 4 }],
  extractedProseChunkMeta: [{ id: 1, file: 'docs/a.md', start: 0, end: 4 }]
});

const { loaded, warnings } = await loadOptionalExtractedProseIndexesWithWarnings(rootDir);

assert.equal(loaded.idxCode.chunkMeta.length, 1, 'expected primary code index to remain available');
assertOptionalExtractedProseDisabled(
  loaded,
  'strict optional extracted-prose with cohort mismatch should be disabled'
);
assert.equal(warnings.length, 0, 'did not expect optional extracted-prose warnings when emitOutput=false');

console.log('optional extracted-prose strict compatibility mismatch test passed');
