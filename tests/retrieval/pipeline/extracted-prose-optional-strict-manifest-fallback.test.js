#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  assertOptionalExtractedProseDisabled,
  createOptionalExtractedProseRoot,
  loadOptionalExtractedProseIndexes,
  writeLegacyChunkMetaIndex,
  writeModeIndex
} from './helpers/optional-extracted-prose-index-fixture.js';

applyTestEnv();

const rootDir = await createOptionalExtractedProseRoot('poc-optional-extracted-strict-');

const compatibilityKey = 'compat-optional-extracted-strict';
const chunkMeta = [{ id: 0, file: 'src/a.js', start: 0, end: 8 }];
await writeModeIndex(rootDir, 'code', compatibilityKey, { chunkMeta });

// Create a legacy extracted-prose directory without a pieces manifest.
// It is discoverable by hasIndexMeta (chunk_meta exists), but optional
// comment-join loading must not fail strict runs for this legacy layout.
await writeLegacyChunkMetaIndex(rootDir, 'extracted-prose');

const loaded = await loadOptionalExtractedProseIndexes(rootDir);

assertOptionalExtractedProseDisabled(
  loaded,
  'expected strict optional extracted-prose load to skip legacy indexes without manifest'
);

console.log('optional extracted-prose strict manifest fallback test passed');
