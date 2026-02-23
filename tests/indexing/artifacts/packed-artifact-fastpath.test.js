#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadTokenPostings } from '../../../src/shared/artifact-io/loaders.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'packed-artifact-fastpath');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const content = `${new Array(400).fill('alpha beta gamma delta epsilon').join('\n')}\n`;
for (let i = 0; i < 12; i += 1) {
  await fsPromises.writeFile(path.join(repoRoot, `big-${i}.js`), content);
}

applyTestEnv();
const baseEnv = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'auto',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
    indexing: {
      postings: {
        fielded: false
      },
      artifacts: {
        tokenPostingsFormat: 'auto',
        tokenPostingsPackedAutoThresholdBytes: 1,
        minhashJsonLargeThreshold: 1
      }
    }
  })
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--mode',
    'code',
    '--stage',
    'stage1',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env: baseEnv, stdio: 'inherit' }
);
if (result.status !== 0) {
  console.error('Failed: build_index (packed artifact fastpath)');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const indexDir = getIndexDir(repoRoot, 'code', userConfig);

const required = [
  'token_postings.packed.bin',
  'token_postings.packed.offsets.bin',
  'token_postings.packed.meta.json',
  'minhash_signatures.packed.bin',
  'minhash_signatures.packed.meta.json'
];
for (const file of required) {
  if (!fs.existsSync(path.join(indexDir, file))) {
    console.error(`Expected packed artifact to exist: ${file}`);
    process.exit(1);
  }
}

const forbidden = [
  'token_postings.json',
  'token_postings.json.gz',
  'token_postings.json.zst',
  'minhash_signatures.json',
  'minhash_signatures.json.gz',
  'minhash_signatures.json.zst'
];
for (const file of forbidden) {
  if (fs.existsSync(path.join(indexDir, file))) {
    console.error(`Expected artifact to be skipped: ${file}`);
    process.exit(1);
  }
}

const tokenIndex = loadTokenPostings(indexDir, { strict: true });
if (!Array.isArray(tokenIndex?.postings) || tokenIndex.postings.length === 0) {
  console.error('Expected packed/binary token_postings loader to return postings rows.');
  process.exit(1);
}

console.log('packed artifact fastpath test passed');
