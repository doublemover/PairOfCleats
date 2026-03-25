#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runBenchExecutionLoop } from '../../../tools/bench/language-repos/run-loop.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `bench-crash-quarantine-${process.pid}-${Date.now()}`);
const repoPath = path.join(tempRoot, 'repos', 'openmoonray');
const outFile = path.join(tempRoot, 'results', 'openmoonray.json');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoPath, { recursive: true });
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(path.join(repoPath, 'README.md'), 'demo repo', 'utf8');

const runCalls = [];
let attachCalls = 0;
const results = await runBenchExecutionLoop({
  executionPlans: [ {
    task: {
      repo: 'dreamworksanimation/openmoonray',
      language: 'cmake',
      queriesPath: path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt')
    },
    repoPath,
    repoLabel: 'cmake/dreamworksanimation/openmoonray',
    tierLabel: 'small',
    repoCacheRoot: path.join(tempRoot, 'cache', 'openmoonray'),
    outFile,
    fallbackLogSlug: 'openmoonray'
  } ],
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
  processRunner: {
    runProcess: async (label, _cmd, _args, options = {}) => {
      runCalls.push({
        label,
        workerPool: options?.env?.PAIROFCLEATS_WORKER_POOL || null
      });
      if (runCalls.length === 1) {
        return {
          ok: false,
          code: 3221225477,
          signal: null,
          schedulerEvents: [],
          diagnostics: {
            crashAttribution: {
              crashClass: 'windows_access_violation',
              recentCleanupLabel: 'runtime.worker-pools.destroy',
              activePhase: 'execute'
            }
          },
          progressConfidence: { bucket: 'low', score: 0.25 }
        };
      }
      await fs.writeFile(outFile, JSON.stringify({
        summary: {
          queries: 1,
          topN: 5,
          annEnabled: false,
          embeddingProvider: 'stub',
          backends: [ 'memory' ],
          queryConcurrency: 4,
          queryWallMs: 10,
          queryWallMsPerSearch: 10,
          queryWallMsPerQuery: 10,
          latencyMsAvg: { memory: 1 },
          latencyMs: { memory: { mean: 1, p50: 1, p95: 1, p99: 1, min: 1, max: 1 } },
          hitRate: { memory: 1 },
          resultCountAvg: { memory: 1 },
          missTaxonomy: { byBackend: { memory: {} }, lowHitByBackend: { memory: {} } },
          memoryRss: { memory: { mean: 1, p50: 1, p95: 1, p99: 1, min: 1, max: 1 } },
          buildMs: null
        }
      }), 'utf8');
      return {
        ok: true,
        schedulerEvents: [],
        diagnostics: { countsByType: {} },
        progressConfidence: { bucket: 'high', score: 1 }
      };
    }
  },
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
    attachCrashRetention: async () => {
      attachCalls += 1;
      return {
        bundlePath: path.join(tempRoot, 'crash-bundle.json'),
        crashState: {
          phase: 'stage3:init'
        }
      };
    },
    cleanRepoCache: async () => {}
  },
  wantsSqlite: false,
  backendList: [ 'memory' ],
  lockMode: 'fail-fast',
  lockWaitMs: 0,
  lockStaleMs: 0,
  benchTimeoutMs: 4321
});

assert.equal(runCalls.length, 2, 'expected one crash attempt and one quarantine retry');
assert.equal(runCalls[0].workerPool, null, 'expected initial attempt to use default worker-pool config');
assert.equal(runCalls[1].workerPool, 'off', 'expected quarantine retry to disable worker pools');
assert.equal(attachCalls, 1, 'expected one retained crash bundle before quarantine retry');
assert.equal(results.length, 1, 'expected one repo result');
assert.equal(results[0]?.failed, undefined, 'expected quarantine retry to recover the repo result');
assert.equal(
  results[0]?.diagnostics?.crashQuarantineRecovery?.quarantineId,
  'openmoonray-worker-pool-off',
  'expected quarantine recovery metadata on successful retry'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench run loop crash quarantine test passed');
