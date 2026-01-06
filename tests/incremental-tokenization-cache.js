#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'incremental-token-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const configPath = path.join(repoRoot, '.pairofcleats.json');
const writeConfig = async (enableChargrams) => {
  await fsPromises.writeFile(
    configPath,
    JSON.stringify({
      indexing: {
        postings: { enableChargrams },
        fileListSampleSize: 10,
        treeSitter: { enabled: false }
      }
    }, null, 2)
  );
};
await writeConfig(false);

const filePath = path.join(repoRoot, 'src.js');
await fsPromises.writeFile(filePath, 'function alpha() { return 1; }\n');

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runBuild = (label) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--incremental', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runBuild('initial build');
runBuild('cache build');

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
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
const cachedEntry = scannedSample.find((entry) => entry?.file && entry.file.endsWith('src.js'));
if (!cachedEntry || cachedEntry.cached !== true) {
  console.error('Expected cached entry after incremental rebuild');
  process.exit(1);
}

await writeConfig(true);
runBuild('config change rebuild');

const fileListsAfter = JSON.parse(await fsPromises.readFile(fileListsPath, 'utf8'));
const scannedAfter = fileListsAfter?.scanned?.sample;
const rebuildEntry = Array.isArray(scannedAfter)
  ? scannedAfter.find((entry) => entry?.file && entry.file.endsWith('src.js'))
  : null;
if (!rebuildEntry || rebuildEntry.cached === true) {
  console.error('Expected cache invalidation after tokenization config change');
  process.exit(1);
}

console.log('incremental tokenization cache test passed');
