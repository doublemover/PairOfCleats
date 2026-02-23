#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-chunk-meta-large-manifest-budget');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const repoRoot = tempRoot;
const indexRoot = path.join(tempRoot, '.index-root');
const indexDir = path.join(indexRoot, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

const chunkMetaPayload = [
  {
    id: 0,
    file: 'src/a.js',
    virtualPath: 'src/a.js',
    chunkId: 'chunk_0',
    chunkUid: 'ck:test:chunk_0',
    fileId: 0,
    start: 0,
    end: 1,
    metaV2: {
      chunkId: 'chunk_0',
      chunkUid: 'ck:test:chunk_0',
      virtualPath: 'src/a.js',
      file: 'src/a.js'
    },
    // intentionally oversized row for tiny test MAX_JSON_BYTES
    docmeta: { note: 'x'.repeat(512) }
  }
];
const chunkMetaPath = path.join(indexDir, 'chunk_meta.json');
await writeJsonObjectFile(chunkMetaPath, { fields: chunkMetaPayload, atomic: true });
const chunkMetaStat = await fs.stat(chunkMetaPath);

const tokenPostings = {
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1],
  avgDocLen: 1,
  totalDocs: 1
};
await writeJsonObjectFile(path.join(indexDir, 'token_postings.json'), { fields: tokenPostings, atomic: true });
await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), { fields: {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
}, atomic: true });
await writeJsonObjectFile(path.join(indexDir, 'file_meta.json'), { fields: [
  { id: 0, file: 'src/a.js', ext: '.js' }
], atomic: true });
await writeJsonObjectFile(path.join(indexDir, '.filelists.json'), { fields: {
  generatedAt: new Date().toISOString(),
  scanned: { count: 1, sample: [] },
  skipped: { count: 0, sample: [] }
}, atomic: true });

const manifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', bytes: chunkMetaStat.size },
    { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ]
};
await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), { fields: manifest, atomic: true });

// Shrink MAX_JSON_BYTES for this process to force use of manifest-derived bytes.
applyTestEnv({
  extraEnv: { PAIROFCLEATS_TEST_MAX_JSON_BYTES: '128' }
});

const { validateIndexArtifacts } = await import('../../../src/index/validate.js');

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: {
    indexing: { postings: { enablePhraseNgrams: false, enableChargrams: false, fielded: false } },
    sqlite: { use: false },
    lmdb: { use: false }
  },
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(
  !report.issues.some((issue) => issue.includes('chunk_meta load failed')),
  `expected no chunk_meta load failure, got: ${report.issues.join('; ')}`
);

console.log('index-validate chunk_meta large manifest budget test passed');
