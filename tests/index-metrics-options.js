#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMetricsDir } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'index-metrics-options');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    indexing: {
      artifactCompression: { enabled: true, mode: 'gzip', keepRaw: true },
      documentExtraction: { enabled: true }
    }
  }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--mode', 'code', '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build index for metrics options test');
  process.exit(buildResult.status ?? 1);
}

const metricsDir = getMetricsDir(repoRoot);
const metricsPath = path.join(metricsDir, 'index-code.json');
if (!fs.existsSync(metricsPath)) {
  console.error(`Expected metrics file at ${metricsPath}`);
  process.exit(1);
}

const metrics = JSON.parse(await fsPromises.readFile(metricsPath, 'utf8'));
const compression = metrics?.artifacts?.compression || {};
const extraction = metrics?.artifacts?.documentExtraction || {};

assert.equal(compression.enabled, true, 'expected compression.enabled to be true');
assert.equal(compression.mode, 'gzip', 'expected compression.mode=gzip');
assert.equal(compression.keepRaw, true, 'expected compression.keepRaw=true');
assert.equal(extraction.enabled, true, 'expected documentExtraction.enabled=true');

console.log('index metrics options test passed');
