#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'summary-report');
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const outPath = path.join(tempRoot, 'compare-sqlite.json');
const modelId = 'Xenova/all-MiniLM-L12-v2';
const markerPath = path.join(tempRoot, 'build-complete.json');

const waitForBuild = async () => {
  if (fs.existsSync(markerPath)) return;
  const timeoutMs = 180000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (fs.existsSync(markerPath)) return;
  }
  console.error('summary report compare (sqlite) failed: build test did not finish in time.');
  process.exit(1);
};

await waitForBuild();
await fsPromises.mkdir(path.dirname(outPath), { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'compare-models.js'),
    '--repo',
    repoRoot,
    '--models',
    modelId,
    '--baseline',
    modelId,
    '--backend',
    'sqlite',
    '--no-build',
    '--no-ann',
    '--limit',
    '5',
    '--top',
    '3',
    '--mode',
    'both',
    '--cache-root',
    cacheRoot,
    '--out',
    outPath
  ],
  { env, encoding: 'utf8', cwd: repoRoot }
);

if (result.status !== 0) {
  console.error('summary report compare (sqlite) failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('summary report compare (sqlite) failed: output JSON missing.');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!payload.summary || !payload.results) {
  console.error('summary report compare (sqlite) failed: missing summary fields.');
  process.exit(1);
}

console.log('summary report compare (sqlite) test passed');
