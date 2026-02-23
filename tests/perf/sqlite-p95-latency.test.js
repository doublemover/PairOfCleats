#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv, resolveSilentStdio } from '../helpers/test-env.js';
import { rmDirRecursive } from '../helpers/temp.js';
import { runSqliteBuild } from '../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = resolveTestCachePath(root, 'sqlite-p95-latency');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index');
await runSqliteBuild(repoRoot);

const queriesPath = path.join(repoRoot, 'queries.txt');
const rawQueries = await fsPromises.readFile(queriesPath, 'utf8');
const queries = rawQueries
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .slice(0, 8);

if (!queries.length) {
  console.error('No queries found for latency test.');
  process.exit(1);
}

const durations = [];
const searchPath = path.join(root, 'search.js');
const runSearch = (query) => {
  const args = [
    searchPath,
    query,
    '--backend',
    'sqlite',
    '--no-ann',
    '--json',
    '--repo',
    repoRoot
  ];
  const start = process.hrtime.bigint();
  const result = spawnSync(
    process.execPath,
    args,
    { cwd: repoRoot, env, stdio: resolveSilentStdio('ignore') }
  );
  const end = process.hrtime.bigint();
  if (result.status !== 0) {
    console.error(`Search failed for query "${query}".`);
    process.exit(result.status ?? 1);
  }
  return Number(end - start) / 1e6;
};

for (const query of queries) {
  runSearch(query);
  for (let i = 0; i < 2; i += 1) {
    durations.push(runSearch(query));
  }
}

durations.sort((a, b) => a - b);
const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
const p95 = durations[p95Index] || 0;
const envBudget = Number(process.env.PAIROFCLEATS_TEST_SQLITE_P95_MAX_MS);
const maxP95Ms = Number.isFinite(envBudget) && envBudget > 0
  ? Math.floor(envBudget)
  : (process.platform === 'win32' ? 7500 : 1500);
if (p95 > maxP95Ms) {
  console.error(`p95 latency ${p95.toFixed(1)}ms exceeded ${maxP95Ms}ms.`);
  process.exit(1);
}

console.log(`SQLite p95 latency ok (${p95.toFixed(1)}ms <= ${maxP95Ms}ms).`);

