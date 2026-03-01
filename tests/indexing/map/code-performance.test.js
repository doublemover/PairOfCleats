#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'code-map-performance');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const funcs = [];
for (let i = 0; i < 180; i += 1) {
  funcs.push(`export function fn${i}() { return ${i}; }`);
}
await fsPromises.writeFile(path.join(repoRoot, 'src', 'many.js'), funcs.join('\n'));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for performance test');
  process.exit(buildResult.status ?? 1);
}

const budgetMs = Number(process.env.PAIROFCLEATS_TEST_CODE_MAP_BUDGET_MS);
const maxMs = Number.isFinite(budgetMs) ? budgetMs : 8000;

const mapStart = performance.now();
const mapResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'reports/report-code-map.js'), '--format', 'json', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
const mapElapsed = performance.now() - mapStart;

if (mapResult.status !== 0) {
  console.error('Failed: map generator');
  process.exit(mapResult.status ?? 1);
}

try {
  JSON.parse(mapResult.stdout || '{}');
} catch {
  console.error('Failed: map output invalid JSON');
  process.exit(1);
}

if (mapElapsed > maxMs) {
  console.error(`Failed: map generation exceeded budget (${Math.round(mapElapsed)}ms > ${maxMs}ms).`);
  process.exit(1);
}

console.log(`code map performance ok (${Math.round(mapElapsed)}ms <= ${maxMs}ms)`);
