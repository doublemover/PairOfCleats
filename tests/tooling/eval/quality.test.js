#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'eval-quality');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const datasetPath = path.join(tempRoot, 'eval-code-only.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const fullDataset = JSON.parse(await fsPromises.readFile(path.join(fixtureRoot, 'eval.json'), 'utf8'));
const codeOnlyDataset = Array.isArray(fullDataset)
  ? fullDataset.filter((entry) => String(entry?.mode || 'code').toLowerCase() === 'code')
  : [];
await fsPromises.writeFile(datasetPath, JSON.stringify(codeOnlyDataset, null, 2));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  syncProcess: false
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', fixtureRoot],
  { env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('eval quality test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const evalResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'eval', 'run.js'),
    '--repo',
    fixtureRoot,
    '--dataset',
    datasetPath,
    '--backend',
    'memory',
    '--no-ann',
    '--top',
    '5'
  ],
  { env, encoding: 'utf8' }
);

if (evalResult.status !== 0) {
  console.error('eval quality test failed: eval run returned error');
  if (evalResult.stderr) console.error(evalResult.stderr.trim());
  process.exit(evalResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(evalResult.stdout || '{}');
} catch (err) {
  console.error('eval quality test failed: invalid JSON output');
  process.exit(1);
}

const summary = payload?.summary || {};
const recallAt5 = summary?.recallAtK?.['5'] ?? 0;
const ndcgAt5 = summary?.ndcgAtK?.['5'] ?? 0;
const mrr = summary?.mrr ?? 0;

if (recallAt5 < 0.6) {
  console.error(`eval quality test failed: recall@5 too low (${recallAt5.toFixed(3)})`);
  process.exit(1);
}
if (ndcgAt5 < 0.6) {
  console.error(`eval quality test failed: ndcg@5 too low (${ndcgAt5.toFixed(3)})`);
  process.exit(1);
}
if (mrr < 0.5) {
  console.error(`eval quality test failed: mrr too low (${mrr.toFixed(3)})`);
  process.exit(1);
}

console.log('eval quality tests passed');

