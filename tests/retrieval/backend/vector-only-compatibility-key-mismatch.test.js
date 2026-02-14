#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';

process.env.PAIROFCLEATS_TESTING = '1';

const createIndex = async (rootDir, mode, { compatibilityKey, profileId }) => {
  const indexDir = path.join(rootDir, `index-${mode}`);
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  const chunkMeta = [{ id: 0, file: `src/${mode}.js`, start: 0, end: 1 }];
  const tokenPostings = {
    vocab: ['alpha'],
    postings: [[[0, 1]]],
    docLengths: [1],
    avgDocLen: 1,
    totalDocs: 1
  };
  const indexState = {
    generatedAt: new Date().toISOString(),
    mode,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    profile: {
      id: profileId,
      schemaVersion: 1
    }
  };
  const fileLists = {
    generatedAt: new Date().toISOString(),
    scanned: { count: 1, sample: [] },
    skipped: { count: 0, sample: [] }
  };
  const pieces = [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ];
  const manifest = {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    pieces
  };
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2));
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState, null, 2));
  await fs.writeFile(path.join(indexDir, '.filelists.json'), JSON.stringify(fileLists, null, 2));
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));
};

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-vector-only-compat-mismatch-'));
await createIndex(rootDir, 'code', {
  compatibilityKey: 'compat-default-profile',
  profileId: 'default'
});
await createIndex(rootDir, 'prose', {
  compatibilityKey: 'compat-vector-only-profile',
  profileId: 'vector_only'
});

let failed = false;
try {
  await loadSearchIndexes({
    rootDir,
    userConfig: {},
    searchMode: 'default',
    runProse: true,
    runExtractedProse: false,
    loadExtractedProse: false,
    runCode: true,
    runRecords: false,
    useSqlite: false,
    useLmdb: false,
    emitOutput: false,
    exitOnError: false,
    annActive: false,
    filtersActive: false,
    contextExpansionEnabled: false,
    sqliteFtsRequested: false,
    backendLabel: 'memory',
    backendForcedTantivy: false,
    indexCache: null,
    modelIdDefault: null,
    fileChargramN: null,
    hnswConfig: { enabled: false },
    lancedbConfig: { enabled: false },
    tantivyConfig: { enabled: false },
    loadIndexFromSqlite: () => ({}),
    loadIndexFromLmdb: () => ({}),
    resolvedDenseVectorMode: 'auto'
  });
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
