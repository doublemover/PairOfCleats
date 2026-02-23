#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'phase18-vector-only-no-sparse');
const outDir = path.join(testRoot, 'index-code');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
applyTestEnv({ testing: '1' });

const state = {
  chunks: [],
  scannedFilesTimes: [],
  scannedFiles: [],
  skippedFiles: [],
  totalTokens: 0,
  fileRelations: new Map(),
  fileInfoByPath: new Map(),
  fileDetailsByPath: new Map(),
  chunkUidToFile: new Map(),
  docLengths: [],
  vfsManifestRows: [],
  vfsManifestCollector: null,
  fieldTokens: [],
  importResolutionGraph: null
};

const postings = await buildPostings({
  chunks: [],
  df: new Map(),
  tokenPostings: new Map(),
  docLengths: [],
  fieldPostings: {},
  fieldDocLengths: {},
  phrasePost: new Map(),
  triPost: new Map(),
  postingsConfig: {},
  embeddingsEnabled: false,
  modelId: 'stub',
  useStubEmbeddings: true,
  log: () => {}
});

const timing = { start: Date.now() };
await writeIndexArtifacts({
  outDir,
  mode: 'code',
  state,
  postings,
  postingsConfig: {},
  modelId: 'stub',
  useStubEmbeddings: true,
  dictSummary: null,
  timing,
  root: testRoot,
  userConfig: {
    indexing: {
      profile: 'vector_only',
      embeddings: { enabled: true }
    }
  },
  incrementalEnabled: false,
  fileCounts: { candidates: 0 },
  perfProfile: null,
  indexState: {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    profile: { id: 'vector_only', schemaVersion: 1 }
  },
  graphRelations: null,
  stageCheckpoints: null
});

const sparseArtifacts = [
  'token_postings.json',
  'token_postings.json.gz',
  'token_postings.json.zst',
  'token_postings.meta.json',
  'token_postings.shards',
  'token_postings.packed.bin',
  'phrase_ngrams.json',
  'chargram_postings.json',
  'field_postings.json',
  'field_tokens.json',
  'vocab_order.json',
  'minhash_signatures.json',
  'minhash_signatures.packed.bin'
];
for (const artifactName of sparseArtifacts) {
  assert.equal(
    fsSync.existsSync(path.join(outDir, artifactName)),
    false,
    `vector_only should not emit sparse artifact ${artifactName}`
  );
}

console.log('vector-only sparse artifact omission test passed');
