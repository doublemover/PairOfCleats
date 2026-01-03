#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getMetricsDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'file-size-guard');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const configPath = path.join(repoRoot, '.pairofcleats.json');
await fsPromises.writeFile(
  configPath,
  JSON.stringify({ indexing: { maxFileBytes: 120, fileListSampleSize: 10 } }, null, 2)
);

const largePath = path.join(repoRoot, 'big.js');
const smallPath = path.join(repoRoot, 'small.js');
await fsPromises.writeFile(largePath, `// big file\n${'x'.repeat(500)}\n`);
await fsPromises.writeFile(smallPath, 'function ok() { return 1; }\n');

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
const oversize = skippedSample.find((entry) => entry?.file && entry.file.endsWith('big.js'));
if (!oversize || oversize.reason !== 'oversize') {
  console.error('Expected oversize skip entry for big.js');
  process.exit(1);
}

const metricsDir = getMetricsDir(repoRoot, userConfig);
const metricsPath = path.join(metricsDir, 'index-code.json');
if (!fs.existsSync(metricsPath)) {
  console.error('Missing index-code metrics');
  process.exit(1);
}
const metrics = JSON.parse(await fsPromises.readFile(metricsPath, 'utf8'));
const oversizeCount = metrics?.files?.skippedByReason?.oversize || 0;
if (oversizeCount < 1) {
  console.error('Expected skippedByReason.oversize to be >= 1');
  process.exit(1);
}

console.log('File size guard test passed');
