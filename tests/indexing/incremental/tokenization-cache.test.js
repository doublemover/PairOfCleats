#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

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

const readCachedEntry = async () => {
  applyTestEnv({ cacheRoot, embeddings: 'stub' });
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const fileListsPath = path.join(codeDir, '.filelists.json');
  if (!fs.existsSync(fileListsPath)) {
    console.error('Missing .filelists.json');
    process.exit(1);
  }
  const fileLists = JSON.parse(await fsPromises.readFile(fileListsPath, 'utf8'));
  const scannedSample = fileLists?.scanned?.sample;
  if (!Array.isArray(scannedSample)) {
    console.error('Scanned sample payload is not an array');
    process.exit(1);
  }
  const entry = scannedSample.find((entry) => entry?.file && entry.file.endsWith('src.js'));
  if (!entry) {
    console.error('Expected sample entry for src.js');
    process.exit(1);
  }
  return entry;
};

runBuild('initial build', { indexing: { postings: { enablePhraseNgrams: false } } });
runBuild('cache build', { indexing: { postings: { enablePhraseNgrams: false } } });

const cachedEntry = await readCachedEntry();
if (!cachedEntry || cachedEntry.cached !== true) {
  console.error('Expected cached entry after incremental rebuild');
  process.exit(1);
}

runBuild('config change rebuild', { indexing: { postings: { enablePhraseNgrams: true } } });

const rebuildEntry = await readCachedEntry();
if (!rebuildEntry || rebuildEntry.cached === true) {
  console.error('Expected cache invalidation after tokenization config change');
  process.exit(1);
}

runBuild('cache build after config change', { indexing: { postings: { enablePhraseNgrams: true } } });
const cachedAfterChange = await readCachedEntry();
if (!cachedAfterChange || cachedAfterChange.cached !== true) {
  console.error('Expected cached entry after config change rebuild');
  process.exit(1);
}

runBuild('dict config change rebuild', {
  indexing: { postings: { enablePhraseNgrams: true } },
  dictionary: { includeSlang: false }
});
const dictEntry = await readCachedEntry();
if (!dictEntry || dictEntry.cached === true) {
  console.error('Expected cache invalidation after dictionary config change');
  process.exit(1);
}

console.log('incremental tokenization cache test passed');
