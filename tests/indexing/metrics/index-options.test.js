#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMetricsDir, toRealPathSync } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-metrics-options');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRootRaw, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const repoRoot = toRealPathSync(repoRootRaw);

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = 1;\n');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--mode', 'code', '--stage', 'stage2', '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build index for metrics options test');
  console.error(`Command: ${process.execPath} ${path.join(root, 'build_index.js')} --mode code --stage stage2 --stub-embeddings --repo ${repoRoot}`);
  console.error(`Exit status: ${buildResult.status ?? 'null'} signal: ${buildResult.signal ?? 'null'}`);
  if (buildResult.error) console.error(buildResult.error);
  if (buildResult.stdout) console.error(buildResult.stdout.trim());
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
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

assert.equal(compression.enabled, false, 'expected compression.enabled to be false by default');
if (!['gzip', 'zstd', null].includes(compression.mode ?? null)) {
  console.error(`Expected compression.mode to be gzip or zstd, got ${compression.mode}`);
  process.exit(1);
}
assert.equal(compression.keepRaw, false, 'expected compression.keepRaw=false by default');
assert.equal(extraction.enabled, false, 'expected documentExtraction.enabled=false by default');

console.log('index metrics options test passed');
