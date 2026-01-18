#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'incremental-cache-signature');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const filePath = path.join(repoRoot, 'src.js');
await fsPromises.writeFile(filePath, 'function alpha() { return 1; }\n');

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const runBuild = (label, testConfig) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--incremental', '--repo', repoRoot],
    {
      cwd: repoRoot,
      env: testConfig
        ? { ...baseEnv, PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) }
        : baseEnv,
      stdio: 'inherit'
    }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runBuild('initial build', { indexing: { lint: false } });
runBuild('cache build', { indexing: { lint: false } });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const fileListsPath = path.join(codeDir, '.filelists.json');
if (!fs.existsSync(fileListsPath)) {
  console.error('Missing .filelists.json');
  process.exit(1);
}
const fileLists = JSON.parse(await fsPromises.readFile(fileListsPath, 'utf8'));
const cachedEntry = fileLists?.scanned?.sample?.find((entry) => entry?.file?.endsWith('src.js'));
if (!cachedEntry || cachedEntry.cached !== true) {
  console.error('Expected cached entry after incremental rebuild');
  process.exit(1);
}

runBuild('config signature rebuild', { indexing: { lint: true } });

const userConfigAfter = loadUserConfig(repoRoot);
const codeDirAfter = getIndexDir(repoRoot, 'code', userConfigAfter);
const fileListsAfter = JSON.parse(await fsPromises.readFile(path.join(codeDirAfter, '.filelists.json'), 'utf8'));
const rebuildEntry = fileListsAfter?.scanned?.sample?.find((entry) => entry?.file?.endsWith('src.js'));
if (!rebuildEntry || rebuildEntry.cached === true) {
  console.error('Expected cache invalidation after config signature change');
  process.exit(1);
}

console.log('incremental cache signature test passed');
