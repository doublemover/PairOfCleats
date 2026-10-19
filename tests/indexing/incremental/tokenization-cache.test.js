#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getRepoId } from '../../../tools/shared/dict-utils.js';
import { getIncrementalPaths } from '../../../src/storage/sqlite/incremental.js';
import { decodeIncrementalManifest } from '../../../src/index/build/incremental/manifest-codec.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cases = ['identical-config', 'tokenization-config', 'dictionary-config'];
const explicitCase = process.argv.indexOf('--case');
const selectedCase = explicitCase >= 0 ? process.argv[explicitCase + 1]
  : process.env.PAIROFCLEATS_TEST_ID?.split('indexing/incremental/tokenization-cache/')[1];
if (selectedCase) assert.ok(cases.includes(selectedCase), `unknown tokenization cache case: ${selectedCase}`);
assert.deepEqual(JSON.parse(await fsPromises.readFile(new URL('./tokenization-cache.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases }, 'every cache comparison remains discoverable');
const tempRoot = resolveTestCachePath(root, 'incremental-token-cache', selectedCase || 'aggregate');
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
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: {
      enabled: false
    }
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
  const result = runNode(
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--scm-provider',
      'none',
      '--incremental',
      '--stage',
      'stage1',
      '--mode',
      'code',
      '--repo',
      repoRoot
    ],
    label,
    repoRoot,
    buildTestEnv(testConfig),
    { stdio: 'inherit', allowFailure: true }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const repoId = getRepoId(repoRoot);
const { manifestPath } = getIncrementalPaths(path.join(cacheRoot, 'repos', repoId), 'code');

const readManifest = async () => {
  try {
    return decodeIncrementalManifest(JSON.parse(await fsPromises.readFile(manifestPath, 'utf8')));
  } catch (error) {
    console.error(`Missing or invalid incremental manifest: ${manifestPath}`);
    console.error(error?.message || String(error));
    process.exit(1);
  }
};

const config = (ngrams, dictionary = {}) => ({
  indexing: { postings: { enablePhraseNgrams: ngrams } }, dictionary
});
runBuild('initial build', config(selectedCase === 'dictionary-config'));
let previous = await readManifest();
if (!selectedCase || selectedCase === 'identical-config') {
  runBuild('cache build', config(false));
  const cached = await readManifest();
  assert.equal(cached.cacheSignature, previous.cacheSignature,
    'Expected stable cache signature for identical tokenization config');
  previous = cached;
}
if (!selectedCase || selectedCase === 'tokenization-config') {
  runBuild('config change rebuild', config(true));
  const changed = await readManifest();
  assert.notEqual(changed.tokenizationKey, previous.tokenizationKey,
    'Expected tokenization key change after phrase n-gram config change');
  previous = changed;
}
if (!selectedCase || selectedCase === 'dictionary-config') {
  runBuild('dict config change rebuild', config(true, { includeSlang: false }));
  assert.notEqual((await readManifest()).cacheSignature, previous.cacheSignature,
    'Expected cache signature change after dictionary config change');
}

console.log('incremental tokenization cache test passed');
