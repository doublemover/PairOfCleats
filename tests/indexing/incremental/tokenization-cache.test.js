#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoId } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-token-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const filePath = path.join(repoRoot, 'src.js');
await fsPromises.writeFile(filePath, 'function alpha() { return 1; }\n');

const BASE_TEST_CONFIG = Object.freeze({
  indexing: {
    scm: { provider: 'none' },
    typeInference: false,
    typeInferenceCrossFile: false
  }
});

const mergeTestConfig = (testConfig) => {
  if (!testConfig || typeof testConfig !== 'object') return BASE_TEST_CONFIG;
  return {
    ...BASE_TEST_CONFIG,
    ...testConfig,
    indexing: {
      ...(BASE_TEST_CONFIG.indexing || {}),
      ...(testConfig.indexing || {})
    }
  };
};

const buildTestEnv = (testConfig) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: mergeTestConfig(testConfig),
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const runBuild = (label, testConfig) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--scm-provider',
      'none',
      '--incremental',
      '--stage',
      'stage2',
      '--mode',
      'code',
      '--repo',
      repoRoot
    ],
    {
      cwd: repoRoot,
      env: buildTestEnv(testConfig),
      stdio: 'inherit'
    }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const repoId = getRepoId(repoRoot);
const manifestPath = path.join(cacheRoot, 'repos', repoId, 'incremental', 'code', 'manifest.json');

const readManifest = async () => {
  try {
    return JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`Missing or invalid incremental manifest: ${manifestPath}`);
    console.error(error?.message || String(error));
    process.exit(1);
  }
};

runBuild('initial build', { indexing: { postings: { enablePhraseNgrams: false } } });
const manifestInitial = await readManifest();
runBuild('cache build', { indexing: { postings: { enablePhraseNgrams: false } } });
const manifestCached = await readManifest();
if (manifestCached.cacheSignature !== manifestInitial.cacheSignature) {
  console.error('Expected stable cache signature for identical tokenization config');
  process.exit(1);
}

runBuild('config change rebuild', { indexing: { postings: { enablePhraseNgrams: true } } });
const manifestTokenChanged = await readManifest();
if (manifestTokenChanged.tokenizationKey === manifestCached.tokenizationKey) {
  console.error('Expected tokenization key change after phrase n-gram config change');
  process.exit(1);
}

runBuild('cache build after config change', { indexing: { postings: { enablePhraseNgrams: true } } });
const manifestTokenStable = await readManifest();
if (manifestTokenStable.cacheSignature !== manifestTokenChanged.cacheSignature) {
  console.error('Expected stable cache signature after unchanged tokenization config rebuild');
  process.exit(1);
}

runBuild('dict config change rebuild', {
  indexing: { postings: { enablePhraseNgrams: true } },
  dictionary: { includeSlang: false }
});
const manifestDictChanged = await readManifest();
if (manifestDictChanged.cacheSignature === manifestTokenStable.cacheSignature) {
  console.error('Expected cache signature change after dictionary config change');
  process.exit(1);
}

console.log('incremental tokenization cache test passed');
