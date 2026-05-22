import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { writeIndexArtifacts } from '../../../../src/index/build/artifacts.js';
import { buildPostings } from '../../../../src/index/build/postings.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const hasTokenPostingsArtifacts = (outDir) => (
  fsSync.existsSync(path.join(outDir, 'token_postings.json'))
  || fsSync.existsSync(path.join(outDir, 'token_postings.json.gz'))
  || fsSync.existsSync(path.join(outDir, 'token_postings.json.zst'))
);

export const readArtifactCleanupActions = async (outDir) => {
  const indexState = JSON.parse(await fs.readFile(path.join(outDir, 'index_state.json'), 'utf8'));
  return Array.isArray(indexState?.extensions?.artifactCleanup?.actions)
    ? indexState.extensions.artifactCleanup.actions
    : [];
};

export const createVectorOnlyBuildRoots = (cacheName) => {
  const repoRoot = process.cwd();
  const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'sample');
  return {
    buildScript: path.join(repoRoot, 'build_index.js'),
    cacheRoot: resolveTestCachePath(repoRoot, cacheName),
    fixtureRoot,
    repoRoot
  };
};

export const createVectorOnlyBuildEnv = ({
  cacheRoot,
  testConfig,
  stage = undefined
}) => {
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^pairofcleats_/i.test(key))
  );
  const env = {
    ...baseEnv,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_WORKER_POOL: 'off',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig)
  };
  if (stage !== undefined) env.PAIROFCLEATS_STAGE = stage;
  return env;
};

export const createVectorOnlyCleanupWriteContext = async (name) => {
  applyTestEnv();
  applyTestEnv({ testing: '1' });

  const root = process.cwd();
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

  return { outDir, runWrite, testRoot };
};
