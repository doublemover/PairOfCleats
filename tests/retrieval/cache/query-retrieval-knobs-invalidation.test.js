#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'query-cache-retrieval-knobs');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const cacheRootResolved = resolveVersionedCacheRoot(cacheRoot);

await rmDirRecursive(tempRoot, { retries: 6, delayMs: 120 });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'cache-knobs.js'),
  [
    'export function greet(name = "world") {',
    '  return `greet ${name}`;',
    '}',
    ''
  ].join('\n')
);

const buildTestConfig = ({
  relationBoostEnabled,
  annCandidateCap,
  sqliteTailLatencyTuning = false,
  sqliteFtsOverfetchRowCap = null
}) => ({
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    scm: { provider: 'none' }
  },
  tooling: {
    autoEnableOnDetect: false,
    lsp: { enabled: false }
  },
  retrieval: {
    relationBoost: {
      enabled: relationBoostEnabled,
      perCall: 0.5,
      perUse: 0.2,
      maxBoost: 2.0
    },
    annCandidateCap,
    annCandidateMinDocCount: 100,
    annCandidateMaxDocCount: 20000,
    sqliteTailLatencyTuning,
    ...(Number.isFinite(Number(sqliteFtsOverfetchRowCap))
      ? { sqliteFtsOverfetchRowCap: Number(sqliteFtsOverfetchRowCap) }
      : {})
  }
});

const envA = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: buildTestConfig({ relationBoostEnabled: false, annCandidateCap: 20000 }),
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  },
  syncProcess: false
});

const run = (args, label, env) => {
  const result = runNode(args, label, repoRoot, env, { stdio: 'pipe' });
  return result.stdout || '';
};

run([
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo',
  repoRoot,
  '--stage',
  'stage1',
  '--mode',
  'code',
  '--no-sqlite'
], 'build index', envA);

const searchArgs = [
  path.join(root, 'search.js'),
  'greet',
  '--mode',
  'code',
  '--json',
  '--stats',
  '--backend',
  'memory',
  '--repo',
  repoRoot
];

const makeCacheKey = (overrides = {}) => buildQueryCacheKey({
  query: 'greet',
  backend: 'memory',
  mode: 'code',
  topN: null,
  sqliteFtsRequested: false,
  ann: false,
  annBackend: null,
  annMode: null,
  annProvider: null,
  annExtension: false,
  annAdaptiveProviders: null,
  relationBoost: { enabled: false, perCall: 0.5, perUse: 0.2, maxBoost: 2.0 },
  annCandidatePolicy: { cap: 20000, minDocCount: 100, maxDocCount: 20000 },
  bm25: { k1: null, b: null },
  scoreBlend: null,
  rrf: null,
  fieldWeights: null,
  symbolBoost: null,
  denseVectorMode: null,
  intent: null,
  minhashMaxDocs: null,
  maxCandidates: null,
  sparseBackend: null,
  explain: false,
  sqliteFtsNormalize: null,
  sqliteFtsProfile: null,
  sqliteFtsWeights: null,
  sqliteFtsVariant: { trigram: false, stemming: false },
  sqliteFtsTuning: {
    tailLatencyTuning: false,
    overfetch: { rowCap: null, timeBudgetMs: null, chunkSize: null }
  },
  comments: { enabled: false },
  models: null,
  embeddings: null,
  contextExpansion: null,
  graphRanking: null,
  filters: null,
  asOf: null,
  ...overrides
}).key;

const baseKey = makeCacheKey();
const relationKey = makeCacheKey({
  relationBoost: { enabled: true, perCall: 0.5, perUse: 0.2, maxBoost: 2.0 }
});
const bm25Key = makeCacheKey({ bm25: { k1: 1.7, b: 0.75 } });
const sqliteTuningKey = makeCacheKey({
  sqliteFtsTuning: {
    tailLatencyTuning: true,
    overfetch: { rowCap: 4096, timeBudgetMs: null, chunkSize: null }
  }
});
if (new Set([baseKey, relationKey, bm25Key, sqliteTuningKey]).size !== 4) {
  console.error('query cache retrieval knobs invalidation test failed: retrieval knobs did not produce distinct cache keys.');
  process.exit(1);
}

const runSearch = (env, label, expectedHit, args = searchArgs) => {
  const payload = JSON.parse(run(args, label, env));
  const cacheHit = payload?.stats?.cache?.hit;
  if (cacheHit !== expectedHit) {
    console.error(`${label} failed: expected cache hit=${expectedHit}, got ${cacheHit}`);
    process.exit(1);
  }
};

runSearch(envA, 'search config A first', false);
runSearch(envA, 'search config A second', true);
const bm25ArgsB = [
  ...searchArgs,
  '--bm25-k1',
  '1.7',
  '--bm25-b',
  '0.75'
];
runSearch(envA, 'search bm25 B first', false, bm25ArgsB);

const repoCacheDirs = await fsPromises.readdir(path.join(cacheRootResolved, 'repos'));
if (!repoCacheDirs.length) {
  console.error('query cache retrieval knobs invalidation test failed: repo cache not created.');
  process.exit(1);
}
const repoCacheRoot = path.join(cacheRootResolved, 'repos', repoCacheDirs[0]);
const queryCachePath = path.join(repoCacheRoot, 'query-cache', 'queryCache.json');
if (!fs.existsSync(queryCachePath)) {
  console.error(`query cache retrieval knobs invalidation test failed: missing cache file at ${queryCachePath}`);
  process.exit(1);
}

console.log('query cache retrieval knobs invalidation test passed');
