#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'summary-report');
const cacheRoot = path.join(tempRoot, 'cache');
const outPath = path.join(tempRoot, 'combined-summary.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'combined-summary.js'),
    '--models',
    'Xenova/all-MiniLM-L12-v2,Xenova/all-MiniLM-L6-v2',
    '--no-ann',
    '--out',
    outPath
  ],
  { env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('summary report test failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('summary report test failed: output JSON missing.');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!payload.summary || !payload.reports) {
  console.error('summary report test failed: missing summary fields.');
  process.exit(1);
}

console.log('summary report test passed');
