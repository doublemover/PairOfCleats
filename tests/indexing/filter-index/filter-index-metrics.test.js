#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMetricsDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'empty');
const buildIndexPath = path.join(root, 'build_index.js');

const cacheRoot = resolveTestCachePath(root, 'filter-index-metrics');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({
  testing: '1',
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    tooling: { autoEnableOnDetect: false }
  }
});

const result = spawnSync(process.execPath, [
  buildIndexPath,
  '--stub-embeddings',
  '--scm-provider',
  'none',
  '--mode',
  'code',
  '--repo',
  fixtureRoot
], {
  cwd: fixtureRoot,
  env,
  stdio: 'inherit'
});

if (result.status !== 0) {
  console.error('filter-index metrics test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(fixtureRoot);
const metricsDir = getMetricsDir(fixtureRoot, userConfig);
const metricsPath = path.join(metricsDir, 'index-code.json');
const rawText = await fs.readFile(metricsPath, 'utf8').catch(() => null);
if (!rawText) {
  console.error(`filter-index metrics test failed: missing metrics file ${metricsPath}`);
  process.exit(1);
}

const parsed = JSON.parse(rawText);
const metrics = parsed?.fields && typeof parsed.fields === 'object' ? parsed.fields : parsed;
const filterIndex = metrics?.artifacts?.filterIndex || null;
if (!filterIndex || typeof filterIndex !== 'object') {
  console.error('filter-index metrics test failed: missing metrics.artifacts.filterIndex.');
  process.exit(1);
}
if (!Number.isFinite(filterIndex.jsonBytes) || filterIndex.jsonBytes <= 0) {
  console.error('filter-index metrics test failed: expected filterIndex.jsonBytes > 0.');
  process.exit(1);
}
if (!Number.isFinite(filterIndex.fileCount) || filterIndex.fileCount < 0) {
  console.error('filter-index metrics test failed: expected numeric filterIndex.fileCount.');
  process.exit(1);
}

console.log('filter-index metrics test passed');

