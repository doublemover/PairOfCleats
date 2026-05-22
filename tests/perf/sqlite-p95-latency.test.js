#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../src/integrations/core/index.js';
import { runSearchCli } from '../../src/retrieval/cli.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { rmDirRecursive } from '../helpers/temp.js';
import { runSqliteBuild } from '../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../helpers/fast-indexing-config.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-p95-latency');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'index.js'),
  [
    'export function greet(name) {',
    '  return `hello ${name}`;',
    '}',
    'export const answer = 42;'
  ].join('\n')
);
await fsPromises.writeFile(path.join(repoRoot, 'queries.txt'), 'greet\nanswer\n');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: createFastIndexingTestConfig(),
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

try {
  await buildIndex(repoRoot, {
    mode: 'code',
    stage: 'stage2',
    sqlite: false,
    'stub-embeddings': true,
    progress: 'off',
    log: () => {},
    warn: () => {},
    logError: (message) => console.error(message)
  });
} catch (err) {
  console.error('Failed: build index');
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
await runSqliteBuild(repoRoot, { mode: 'code', env, emitOutput: false });

const queriesPath = path.join(repoRoot, 'queries.txt');
const rawQueries = await fsPromises.readFile(queriesPath, 'utf8');
const queries = rawQueries
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .slice(0, 2);

if (!queries.length) {
  console.error('No queries found for latency test.');
  process.exit(1);
}

const durations = [];
const indexCache = new Map();
const sqliteCache = new Map();
const runSearch = async (query) => {
  const args = [
    query,
    '--backend',
    'sqlite',
    '--no-ann',
    '--json',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ];
  const start = process.hrtime.bigint();
  let payload = null;
  try {
    payload = await runSearchCli(args, {
      emitOutput: false,
      exitOnError: false,
      indexCache,
      sqliteCache
    });
  } catch (err) {
    console.error(`Search failed for query "${query}".`);
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  }
  const end = process.hrtime.bigint();
  if (!payload || payload.ok === false) {
    console.error(`Search failed for query "${query}".`);
    process.exit(1);
  }
  return Number(end - start) / 1e6;
};

for (const query of queries) {
  await runSearch(query);
  durations.push(await runSearch(query));
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

