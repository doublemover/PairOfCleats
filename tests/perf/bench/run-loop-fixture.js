import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runBenchExecutionLoop } from '../../../tools/bench/language-repos/run-loop.js';

export const createMemoryBenchSummary = ({
  queryWallMs = 10,
  latencyMs = 1,
  hitRate = 1,
  resultCountAvg = 1,
  buildMs = null
} = {}) => ({
  summary: {
    queries: 1,
    topN: 5,
    annEnabled: false,
    embeddingProvider: 'stub',
    backends: ['memory'],
    queryConcurrency: 4,
    queryWallMs,
    queryWallMsPerSearch: queryWallMs,
    queryWallMsPerQuery: queryWallMs,
    latencyMsAvg: { memory: latencyMs },
    latencyMs: {
      memory: { mean: latencyMs, p50: latencyMs, p95: latencyMs, p99: latencyMs, min: latencyMs, max: latencyMs }
    },
    hitRate: { memory: hitRate },
    resultCountAvg: { memory: resultCountAvg },
    missTaxonomy: { byBackend: { memory: {} }, lowHitByBackend: { memory: {} } },
    memoryRss: { memory: { mean: 1, p50: 1, p95: 1, p99: 1, min: 1, max: 1 } },
    buildMs
  }
});

export const createBenchRunLoopFixture = async ({
  name,
  repo = 'demo/repo',
  language = null,
  repoDirName = 'demo',
  repoLabel = repo,
  tierLabel = 'small',
  fallbackLogSlug = repoDirName
}) => {
  ensureTestingEnv(process.env);

  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, `${name}-${process.pid}-${Date.now()}`);
  const repoPath = path.join(tempRoot, 'repos', repoDirName);
  const outFile = path.join(tempRoot, 'results', `${repoDirName}.json`);

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(path.join(repoPath, 'README.md'), 'demo repo', 'utf8');

  const task = {
    repo,
    queriesPath: path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt'),
    ...(language ? { language } : {})
  };

  return {
    cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
    outFile,
    repoPath,
    root,
    tempRoot,
    run: (overrides = {}) => runBenchExecutionLoop({
      executionPlans: [{
        task,
        repoPath,
        repoLabel,
        tierLabel,
        repoCacheRoot: path.join(tempRoot, 'cache', repoDirName),
        outFile,
        fallbackLogSlug
      }],
      argv: {
        build: false,
        'build-index': false,
        'build-sqlite': false,
        progress: 'off',
        quiet: true,
        json: false,
        incremental: false,
        ann: false,
        'no-ann': true,
        backend: 'memory',
        top: 5,
        limit: 1,
        threads: null,
        verbose: false,
        'stub-embeddings': true
      },
      scriptRoot: root,
      baseEnv: { ...process.env },
      appendLog: () => {},
      display: { error() {} },
      quietMode: true,
      dryRun: false,
      repoLogsEnabled: false,
      initRepoLog: async () => null,
      getRepoLogPath: () => null,
      clearLogHistory: () => {},
      hasDiskFullMessageInHistory: () => false,
      progressRuntime: {
        beginRepo() {},
        update() {},
        completeRepo() {}
      },
      lifecycle: {
        hasRepoPath: () => true,
        ensureRepoPresent: async () => ({ ok: true }),
        prepareRepoWorkspace: async () => ({ ok: true }),
        attachCrashRetention: async () => null,
        cleanRepoCache: async () => {}
      },
      wantsSqlite: false,
      backendList: ['memory'],
      lockMode: 'fail-fast',
      lockWaitMs: 0,
      lockStaleMs: 0,
      benchTimeoutMs: 4321,
      ...overrides
    })
  };
};
