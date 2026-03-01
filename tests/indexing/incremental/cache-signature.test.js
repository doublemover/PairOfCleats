#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoId } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-cache-signature');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const filePath = path.join(repoRoot, 'src.js');
await fsPromises.writeFile(filePath, 'function alpha() { return 1; }\n');

const buildTestEnv = (testConfig) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: testConfig ?? null,
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
      '--stage',
      'stage2',
      '--mode',
      'code',
      '--scm-provider',
      'none',
      '--incremental',
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

runBuild('initial build', { indexing: { lint: false } });
const repoId = getRepoId(repoRoot);
const manifestPath = path.join(cacheRoot, 'repos', repoId, 'incremental', 'code', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Missing incremental manifest after initial build');
  process.exit(1);
}
const manifestInitial = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
runBuild('cache build', { indexing: { lint: false } });
const manifestCached = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
if (!manifestCached?.cacheSignature || manifestCached.cacheSignature !== manifestInitial?.cacheSignature) {
  console.error('Expected unchanged incremental cache signature for identical config rebuild');
  process.exit(1);
}

runBuild('config signature rebuild', { indexing: { lint: true } });
const manifestChanged = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
if (!manifestChanged?.cacheSignature || manifestChanged.cacheSignature === manifestCached.cacheSignature) {
  console.error('Expected incremental cache signature change after config signature change');
  process.exit(1);
}

console.log('incremental cache signature test passed');
