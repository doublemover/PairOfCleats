#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
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
// The format cutover rejects this layout even for optional comment joins.
await writeLegacyChunkMetaIndex(rootDir, 'extracted-prose');

await assert.rejects(loadOptionalExtractedProseIndexes(rootDir),
  { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' },
  'optional extracted prose cannot silently reuse a superseded manifestless index');

console.log('optional extracted-prose strict manifest rejection test passed');
