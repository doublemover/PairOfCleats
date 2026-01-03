#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'benchmarks', 'cache', 'compare-models');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const models = [
  'Xenova/all-MiniLM-L12-v2',
  'Xenova/all-MiniLM-L6-v2'
];

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'compare-models.js'),
    '--models',
    models.join(','),
    '--build',
    '--stub-embeddings',
    '--no-ann',
    '--limit',
    '2',
    '--json'
  ],
  { cwd: fixtureRoot, env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('compare models test failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
if (!payload.summary || !payload.settings || !payload.results) {
  console.error('compare models test failed: missing fields.');
  process.exit(1);
}
if (!Array.isArray(payload.settings.models) || payload.settings.models.length < 2) {
  console.error('compare models test failed: models missing.');
  process.exit(1);
}
if (!payload.summary.models || !payload.summary.comparisons) {
  console.error('compare models test failed: summary missing.');
  process.exit(1);
}

console.log('compare models test passed');
