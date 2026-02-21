#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-optional-extracted-strict-'));

const codeIndexDir = path.join(rootDir, 'index-code');
await fs.mkdir(path.join(codeIndexDir, 'pieces'), { recursive: true });

const compatibilityKey = 'compat-optional-extracted-strict';
const chunkMeta = [{ id: 0, file: 'src/a.js', start: 0, end: 8 }];
const tokenPostings = {
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1],
  avgDocLen: 1,
  totalDocs: 1
};
const indexState = {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey
};
const manifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey,
  pieces: [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' }
  ]
};

await fs.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
await fs.writeFile(path.join(codeIndexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2));
await fs.writeFile(path.join(codeIndexDir, 'index_state.json'), JSON.stringify(indexState, null, 2));
await fs.writeFile(path.join(codeIndexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

// Create a legacy extracted-prose directory without a pieces manifest.
// It is discoverable by hasIndexMeta (chunk_meta exists), but optional
// comment-join loading must not fail strict runs for this legacy layout.
const extractedProseDir = path.join(rootDir, 'index-extracted-prose');
await fs.mkdir(extractedProseDir, { recursive: true });
await fs.writeFile(path.join(extractedProseDir, 'chunk_meta.json'), JSON.stringify([], null, 2));

const loaded = await loadSearchIndexes({
  rootDir,
  userConfig: {},
  searchMode: 'code',
  runProse: false,
  runExtractedProse: false,
  loadExtractedProse: true,
  runCode: true,
  runRecords: false,
  useSqlite: false,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: false,
  filtersActive: false,
  contextExpansionEnabled: false,
  graphRankingEnabled: false,
  sqliteFtsRequested: false,
  backendLabel: 'memory',
  backendForcedTantivy: false,
  indexCache: null,
  modelIdDefault: null,
  fileChargramN: null,
  hnswConfig: { enabled: false },
  lancedbConfig: { enabled: true },
  tantivyConfig: { enabled: false },
  strict: true,
  loadIndexFromSqlite: () => ({}),
  loadIndexFromLmdb: () => ({}),
  resolvedDenseVectorMode: 'merged'
});

assert.equal(
  loaded.runExtractedProse,
  false,
  'expected optional extracted-prose mode to remain disabled'
);
assert.equal(
  loaded.extractedProseLoaded,
  false,
  'expected strict optional extracted-prose load to skip legacy indexes without manifest'
);
assert.deepEqual(
  loaded.idxExtractedProse?.chunkMeta || [],
  [],
  'expected skipped optional extracted-prose load to keep empty index payload'
);

console.log('optional extracted-prose strict manifest fallback test passed');
