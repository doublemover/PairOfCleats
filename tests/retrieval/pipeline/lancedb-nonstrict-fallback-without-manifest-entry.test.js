#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const fixtureRoot = path.join(root, '.testCache', 'lancedb-nonstrict-fallback-without-manifest-entry');
const indexDir = path.join(fixtureRoot, 'index-code');
await fs.rm(fixtureRoot, { recursive: true, force: true });
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(indexDir, 'dense_vectors.lancedb'), { recursive: true });

const compatibilityKey = 'compat-lancedb-nonstrict-fallback';
const dims = 4;
const chunkMeta = [{ id: 0, file: 'src/a.js', start: 0, end: 1 }];
const fileMeta = [{ id: 0, file: 'src/a.js', ext: '.js' }];
const tokenPostings = {
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1],
  avgDocLen: 1,
  totalDocs: 1
};
const denseVectors = {
  dims,
  model: 'stub-model',
  scale: 1,
  minVal: -1,
  maxVal: 1,
  levels: 255,
  vectors: [new Array(dims).fill(0)]
};
const lanceMeta = {
  version: 1,
  generatedAt: new Date().toISOString(),
  model: 'stub-model',
  dims,
  count: 1,
  metric: 'cosine',
  table: 'vectors',
  embeddingColumn: 'vector',
  idColumn: 'id',
  scale: 1,
  minVal: -1,
  maxVal: 1,
  levels: 255
};
const indexState = {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey,
  embeddings: {
    ready: true,
    pending: false,
    embeddingIdentity: {
      dims,
      model: 'stub-model',
      scale: 1,
      minVal: -1,
      maxVal: 1,
      levels: 255
    }
  }
};
const fileLists = {
  generatedAt: new Date().toISOString(),
  scanned: { count: 1, sample: [] },
  skipped: { count: 0, sample: [] }
};
const manifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey,
  pieces: [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' },
    { type: 'embeddings', name: 'dense_vectors', format: 'json', path: 'dense_vectors_uint8.json', count: 1, dims }
  ]
};

await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunkMeta, null, 2));
await fs.writeFile(path.join(indexDir, 'file_meta.json'), JSON.stringify(fileMeta, null, 2));
await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify(tokenPostings, null, 2));
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify(indexState, null, 2));
await fs.writeFile(path.join(indexDir, '.filelists.json'), JSON.stringify(fileLists, null, 2));
await fs.writeFile(path.join(indexDir, 'dense_vectors_uint8.json'), JSON.stringify(denseVectors, null, 2));
await fs.writeFile(path.join(indexDir, 'dense_vectors.lancedb.meta.json'), JSON.stringify(lanceMeta, null, 2));
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

const loaded = await loadSearchIndexes({
  rootDir: fixtureRoot,
  userConfig: {},
  searchMode: 'code',
  runProse: false,
  runExtractedProse: false,
  loadExtractedProse: false,
  runCode: true,
  runRecords: false,
  useSqlite: false,
  useLmdb: false,
  emitOutput: false,
  exitOnError: false,
  annActive: true,
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
  strict: false,
  loadIndexFromSqlite: () => ({}),
  loadIndexFromLmdb: () => ({}),
  resolvedDenseVectorMode: 'merged',
  requiredArtifacts: new Set(['ann'])
});

assert.ok(loaded?.idxCode?.lancedb, 'expected lancedb metadata object to be present');
assert.equal(loaded.idxCode.lancedb.available, false, 'expected lancedb to be unavailable without manifest entries');
assert.equal(loaded.idxCode.lancedb.meta, null, 'expected lancedb meta to remain null without manifest entries');

console.log('lancedb manifest entry required contract test passed');
