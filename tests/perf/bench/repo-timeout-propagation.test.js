#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runBenchExecutionLoop } from '../../../tools/bench/language-repos/run-loop.js';
import { resolveBenchProcessTimeoutProfile } from '../../../tools/bench/language/timeout.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `bench-timeout-propagation-${process.pid}-${Date.now()}`);
const repoPath = path.join(tempRoot, 'repos', 'demo');
const outFile = path.join(tempRoot, 'results', 'demo.json');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoPath, { recursive: true });
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(path.join(repoPath, 'README.md'), 'demo repo', 'utf8');

let capturedTimeoutMs = null;
let capturedIdleTimeoutMs = null;
const results = await runBenchExecutionLoop({
  executionPlans: [{
    task: {
      repo: 'demo/repo',
      queriesPath: path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt')
    },
    repoPath,
    repoLabel: 'demo/repo',
    tierLabel: 'small',
    repoCacheRoot: path.join(tempRoot, 'cache', 'demo'),
    outFile,
    fallbackLogSlug: 'demo-repo'
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
  processRunner: {
    runProcess: async (_label, _cmd, _args, options = {}) => {
      capturedTimeoutMs = options.timeoutMs;
      capturedIdleTimeoutMs = options.idleTimeoutMs;
      await fs.writeFile(outFile, JSON.stringify({
        summary: {
          queries: 1,
          topN: 5,
          annEnabled: false,
          embeddingProvider: 'stub',
          backends: ['memory'],
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
      return { ok: true, schedulerEvents: [] };
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
    attachCrashRetention: async () => null,
    cleanRepoCache: async () => {}
  },
  wantsSqlite: false,
  backendList: ['memory'],
  lockMode: 'fail-fast',
  lockWaitMs: 0,
  lockStaleMs: 0,
  benchTimeoutMs: 4321
});

const expectedTimeoutProfile = resolveBenchProcessTimeoutProfile({ repoTimeoutMs: 4321 });
assert.equal(capturedIdleTimeoutMs, expectedTimeoutProfile.idleTimeoutMs, 'expected idle bench timeout to be forwarded to the repo subprocess');
assert.equal(capturedTimeoutMs, expectedTimeoutProfile.hardTimeoutMs, 'expected hard bench timeout profile to be forwarded to the repo subprocess');
assert.equal(Array.isArray(results), true, 'expected result list');
assert.equal(results.length, 1, 'expected one result row');
assert.equal(results[0]?.failed, undefined, 'expected successful repo result');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench repo timeout propagation test passed');
