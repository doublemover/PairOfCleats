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
const testRoot = resolveTestCachePath(root, 'phase18-vector-only-allowlist-safety');
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

const runWrite = async ({ profileId }) => {
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
        profile: profileId,
        embeddings: { enabled: profileId === 'vector_only' }
      }
    },
    incrementalEnabled: false,
    fileCounts: { candidates: 0 },
    perfProfile: null,
    indexState: {
      generatedAt: new Date().toISOString(),
      mode: 'code',
      profile: { id: profileId, schemaVersion: 1 }
    },
    graphRelations: null,
    stageCheckpoints: null
  });
};

await runWrite({ profileId: 'default' });
const unknownFileName = 'token_postings.custom.keep';
const unknownDirName = 'token_postings.custom.dir';
const unknownSentinelName = 'sentinel.txt';
const unknownFilePath = path.join(outDir, unknownFileName);
const unknownDirPath = path.join(outDir, unknownDirName);
const unknownSentinelPath = path.join(unknownDirPath, unknownSentinelName);
await fs.mkdir(unknownDirPath, { recursive: true });
await fs.writeFile(unknownFilePath, 'keep-me\n', 'utf8');
await fs.writeFile(unknownSentinelPath, 'keep-dir\n', 'utf8');
assert.equal(fsSync.existsSync(unknownFilePath), true, 'expected unknown sparse-like file before cleanup');
assert.equal(fsSync.existsSync(unknownSentinelPath), true, 'expected unknown sparse-like dir before cleanup');

await runWrite({ profileId: 'vector_only' });
assert.equal(fsSync.existsSync(unknownFilePath), true, 'vector_only cleanup should not delete unknown file');
assert.equal(fsSync.existsSync(unknownSentinelPath), true, 'vector_only cleanup should not delete unknown directory');
assert.equal(
  fsSync.existsSync(path.join(outDir, 'token_postings.json'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.gz'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.zst')),
  false,
  'known sparse artifact should be removed'
);
assert.equal(fsSync.existsSync(path.join(outDir, 'token_postings.shards')), false, 'known sparse shard dir should be removed');

const indexState = JSON.parse(await fs.readFile(path.join(outDir, 'index_state.json'), 'utf8'));
const actions = Array.isArray(indexState?.extensions?.artifactCleanup?.actions)
  ? indexState.extensions.artifactCleanup.actions
  : [];
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes(unknownFileName)),
  false,
  'cleanup report should not include unknown file'
);
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes(unknownDirName)),
  false,
  'cleanup report should not include unknown directory'
);

console.log('vector-only cleanup allowlist safety test passed');
