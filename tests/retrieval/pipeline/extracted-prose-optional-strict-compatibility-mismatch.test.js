#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-optional-extracted-strict-compat-mismatch-'));

const writeModeIndex = async (mode, compatibilityKey, { chunkMeta = [] } = {}) => {
  const indexDir = path.join(rootDir, `index-${mode}`);
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const indexState = {
    generatedAt: new Date().toISOString(),
    mode,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey
  };
  const tokenPostings = {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
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
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
};

await writeModeIndex('code', 'compat-cohort-a', {
  chunkMeta: [{ id: 0, file: 'src/a.js', start: 0, end: 4 }]
});
await writeModeIndex('extracted-prose', 'compat-cohort-b', {
  chunkMeta: [{ id: 1, file: 'docs/a.md', start: 0, end: 4 }]
});

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

assert.equal(loaded.runExtractedProse, false, 'optional extracted-prose run flag should remain disabled');
assert.equal(
  loaded.extractedProseLoaded,
  false,
  'strict optional extracted-prose with cohort mismatch should be disabled'
);
assert.equal(loaded.idxCode.chunkMeta.length, 1, 'expected primary code index to remain available');
assert.deepEqual(
  loaded.idxExtractedProse?.chunkMeta || [],
  [],
  'expected optional extracted-prose index to remain empty when disabled'
);

console.log('optional extracted-prose strict compatibility mismatch test passed');
