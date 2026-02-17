#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'phase18-vector-only-switch-cleanup');
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
assert.equal(
  fsSync.existsSync(path.join(outDir, 'token_postings.json'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.gz'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.zst')),
  true,
  'expected default profile write to emit token_postings artifact'
);

await runWrite({ profileId: 'vector_only' });
assert.equal(
  fsSync.existsSync(path.join(outDir, 'token_postings.json'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.gz'))
    || fsSync.existsSync(path.join(outDir, 'token_postings.json.zst')),
  false,
  'expected vector_only profile write to clean stale token_postings artifact'
);

const indexState = JSON.parse(await fs.readFile(path.join(outDir, 'index_state.json'), 'utf8'));
const actions = Array.isArray(indexState?.extensions?.artifactCleanup?.actions)
  ? indexState.extensions.artifactCleanup.actions
  : [];
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes('token_postings')),
  true,
  'expected cleanup report to include token_postings removal actions'
);

console.log('vector-only stale sparse cleanup test passed');
