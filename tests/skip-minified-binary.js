#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getMetricsDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'skip-minified-binary');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const configPath = path.join(repoRoot, '.pairofcleats.json');
await fsPromises.writeFile(
  configPath,
  JSON.stringify({
    indexing: {
      maxFileBytes: 200000,
      fileListSampleSize: 20,
      treeSitter: { enabled: false }
    }
  }, null, 2)
);

const minifiedPath = path.join(repoRoot, 'app.min.js');
const binaryPath = path.join(repoRoot, 'binary.js');
const normalPath = path.join(repoRoot, 'normal.js');
await fsPromises.writeFile(minifiedPath, 'function minified(){return 42;}');
await fsPromises.writeFile(normalPath, 'function ok() { return 1; }\n');
await fsPromises.writeFile(binaryPath, Buffer.alloc(70000, 0));

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const fileListsPath = path.join(codeDir, '.filelists.json');
if (!fs.existsSync(fileListsPath)) {
  console.error('Missing .filelists.json');
  process.exit(1);
}
const fileLists = JSON.parse(await fsPromises.readFile(fileListsPath, 'utf8'));
const skippedSample = fileLists?.skipped?.sample;
if (!Array.isArray(skippedSample)) {
  console.error('Skipped sample payload is not an array');
  process.exit(1);
}
const minifiedSkip = skippedSample.find((entry) => entry?.file && entry.file.endsWith('app.min.js'));
if (!minifiedSkip || minifiedSkip.reason !== 'minified') {
  console.error('Expected minified skip entry for app.min.js');
  process.exit(1);
}
const binarySkip = skippedSample.find((entry) => entry?.file && entry.file.endsWith('binary.js'));
if (!binarySkip || binarySkip.reason !== 'binary') {
  console.error('Expected binary skip entry for binary.js');
  process.exit(1);
}

const metricsDir = getMetricsDir(repoRoot, userConfig);
const metricsPath = path.join(metricsDir, 'index-code.json');
if (!fs.existsSync(metricsPath)) {
  console.error('Missing index-code metrics');
  process.exit(1);
}
const metrics = JSON.parse(await fsPromises.readFile(metricsPath, 'utf8'));
const minifiedCount = metrics?.files?.skippedByReason?.minified || 0;
const binaryCount = metrics?.files?.skippedByReason?.binary || 0;
if (minifiedCount < 1 || binaryCount < 1) {
  console.error('Expected skippedByReason.minified and skippedByReason.binary to be >= 1');
  process.exit(1);
}

console.log('minified/binary skip test passed');
