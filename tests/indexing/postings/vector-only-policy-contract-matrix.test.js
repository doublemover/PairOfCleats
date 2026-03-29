#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { resolveVectorOnlyShortcutPolicy, buildFeatureSettings } from '../../../src/index/build/indexer/pipeline.js';
import { resolveChunkProcessingFeatureFlags } from '../../../src/index/build/indexer/steps/process-files.js';
import { applyTestEnv, ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'sample');
const buildScript = path.join(repoRoot, 'build_index.js');

const createWriteContext = async (name) => {
  const testRoot = resolveTestCachePath(root, name);
  const outDir = path.join(testRoot, 'index-code');
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
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
    await writeIndexArtifacts({
      outDir,
      mode: 'code',
      state,
      postings,
      postingsConfig: {},
      modelId: 'stub',
      useStubEmbeddings: true,
      dictSummary: null,
      timing: { start: Date.now() },
      root: testRoot,
      userConfig: {
        indexing: {
          profile: profileId,
          embeddings: { enabled: profileId === INDEX_PROFILE_VECTOR_ONLY }
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
  return { testRoot, outDir, runWrite };
};

const hasSparseArtifacts = (outDir) => (
  fsSync.existsSync(path.join(outDir, 'token_postings.json'))
  || fsSync.existsSync(path.join(outDir, 'token_postings.json.gz'))
  || fsSync.existsSync(path.join(outDir, 'token_postings.json.zst'))
);

const cases = [
  {
    name: 'vector-only runtime policy keeps tokenization but disables sparse postings',
    async run() {
      const vectorRuntime = {
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY },
        analysisPolicy: {}
      };
      const vectorSettings = buildFeatureSettings(vectorRuntime, 'code');
      assert.equal(vectorSettings.tokenize, true);
      assert.equal(vectorSettings.postings, false);

      const vectorFlags = resolveChunkProcessingFeatureFlags(vectorRuntime);
      assert.equal(vectorFlags.tokenizeEnabled, true);
      assert.equal(vectorFlags.sparsePostingsEnabled, false);

      const shortcutPolicy = resolveVectorOnlyShortcutPolicy({
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: { profile: INDEX_PROFILE_VECTOR_ONLY }
      });
      assert.equal(shortcutPolicy.enabled, true);
      assert.equal(shortcutPolicy.disableImportGraph, true);
      assert.equal(shortcutPolicy.disableCrossFileInference, true);
    }
  },
  {
    name: 'vector-only shortcuts honor explicit opt-out',
    async run() {
      const shortcutPolicy = resolveVectorOnlyShortcutPolicy({
        profile: { id: INDEX_PROFILE_VECTOR_ONLY },
        indexingConfig: {
          profile: INDEX_PROFILE_VECTOR_ONLY,
          vectorOnly: {
            disableImportGraph: false,
            disableCrossFileInference: false
          }
        }
      });
      assert.equal(shortcutPolicy.enabled, true);
      assert.equal(shortcutPolicy.disableImportGraph, false);
      assert.equal(shortcutPolicy.disableCrossFileInference, false);
    }
  },
  {
    name: 'vector-only writes omit sparse artifacts on a clean output root',
    async run() {
      const { outDir, runWrite } = await createWriteContext('postings-vector-only-clean-write');
      await runWrite({ profileId: INDEX_PROFILE_VECTOR_ONLY });
      assert.equal(hasSparseArtifacts(outDir), false);
      assert.equal(fsSync.existsSync(path.join(outDir, 'token_postings.shards')), false);
    }
  },
  {
    name: 'vector-only builds fail closed when embeddings are disabled',
    async run() {
      const cacheRoot = resolveTestCachePath(root, 'postings-vector-only-missing-embeddings');
      const testConfig = {
        indexing: {
          profile: INDEX_PROFILE_VECTOR_ONLY,
          embeddings: {
            enabled: true,
            mode: 'off',
            hnsw: { enabled: false },
            lancedb: { enabled: false }
          }
        },
        sqlite: { use: false },
        lmdb: { use: false }
      };
      const baseEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^pairofcleats_/i.test(key))
      );
      const env = {
        ...baseEnv,
        PAIROFCLEATS_CACHE_ROOT: cacheRoot,
        PAIROFCLEATS_STAGE: '',
        PAIROFCLEATS_WORKER_POOL: 'off',
        PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig)
      };
      ensureTestingEnv(env);

      const result = spawnSync(
        process.execPath,
        [buildScript, '--repo', fixtureRoot, '--mode', 'code', '--stage', 'stage2'],
        { cwd: fixtureRoot, env, encoding: 'utf8' }
      );
      assert.notEqual(result.status, 0);
      const output = `${result.stderr || ''}\n${result.stdout || ''}`;
      assert.equal(output.includes('indexing.profile=vector_only requires embeddings'), true);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('vector-only policy contract matrix test passed');
