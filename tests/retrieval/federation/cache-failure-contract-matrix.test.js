#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const writeRepo = async (repoRoot, cacheRoot, modes = ['code']) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'test-build',
    buildRoot,
    modes
  }, null, 2), 'utf8');
  for (const mode of modes) {
    const indexDir = path.join(buildRoot, `index-${mode}`);
    await fs.mkdir(indexDir, { recursive: true });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
    await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
    await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: `compat-${mode}`
    }, null, 2), 'utf8');
  }
};

const withTempRoot = async (prefix, run) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run({
      tempRoot,
      cacheRoot: path.join(tempRoot, 'cache')
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

const cases = [
  {
    name: 'invalid build pointers clear repo cache state',
    async run() {
      await withTempRoot('poc-fed-cache-pointer-clear-', async ({ tempRoot, cacheRoot }) => {
        const repoRoot = path.join(tempRoot, 'repo');
        await fs.mkdir(repoRoot, { recursive: true });
        await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
          cache: { root: cacheRoot }
        }, null, 2), 'utf8');

        const userConfig = loadUserConfig(repoRoot);
        const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
        const currentPath = path.join(repoCacheRoot, 'builds', 'current.json');
        await fs.mkdir(path.dirname(currentPath), { recursive: true });
        await fs.writeFile(currentPath, '{invalid-json', 'utf8');

        const manager = createRepoCacheManager({ defaultRepo: repoRoot });
        const entry = manager.getRepoCaches(repoRoot);
        entry.buildId = 'build-1';
        entry.indexCache.set('sentinel', { value: 1 });
        assert.equal(entry.indexCache.size(), 1);

        await manager.refreshBuildPointer(entry);

        assert.equal(entry.buildId, null);
        assert.equal(entry.indexCache.size(), 0);
        manager.closeRepoCaches();
      });
    }
  },
  {
    name: 'partial failures are not reused from federated cache',
    async run() {
      await withTempRoot('poc-fed-cache-partial-', async ({ tempRoot, cacheRoot }) => {
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo(repoA, cacheRoot);
        await writeRepo(repoB, cacheRoot);
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "a", "priority": 10 },
    { "root": "./repo-b", "alias": "b", "priority": 5 }
  ]
}`, 'utf8');

        let searchCalls = 0;
        const repoAttempts = new Map();
        const searchFn = async (repoRootCanonical) => {
          searchCalls += 1;
          const leaf = path.basename(repoRootCanonical);
          const attempts = (repoAttempts.get(leaf) || 0) + 1;
          repoAttempts.set(leaf, attempts);
          if (leaf === 'repo-a' && attempts === 1) {
            throw createError(ERROR_CODES.NO_INDEX, 'simulated transient index miss');
          }
          return {
            backend: 'memory',
            code: [{ id: `hit-${leaf}`, file: `src/${leaf}.js`, start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };

        const request = {
          workspacePath,
          query: 'partial-failure-cache',
          search: { mode: 'code', top: 5 },
          limits: { concurrency: 1 }
        };

        const first = await runFederatedSearch(request, { searchFn });
        assert.equal(first.ok, true);
        assert.equal(first.status, 'partial');
        assert.equal(first.code.length, 1);

        const second = await runFederatedSearch(request, { searchFn });
        assert.equal(second.ok, true);
        assert.equal(second.status, 'complete');
        assert.equal(second.code.length, 2);
        assert.equal(searchCalls, 4);
      });
    }
  },
  {
    name: 'aborted requests do not cache partial success from early repos',
    async run() {
      await withTempRoot('poc-fed-cache-abort-', async ({ tempRoot, cacheRoot }) => {
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo(repoA, cacheRoot);
        await writeRepo(repoB, cacheRoot);
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "a", "priority": 10 },
    { "root": "./repo-b", "alias": "b", "priority": 5 }
  ]
}`, 'utf8');

        let searchCalls = 0;
        const controller = new AbortController();
        const searchFn = async (repoRootCanonical, params) => {
          searchCalls += 1;
          const leaf = path.basename(repoRootCanonical);
          if (leaf === 'repo-a') {
            controller.abort();
            return {
              backend: 'memory',
              code: [{ id: 'hit-a', file: 'src/a.js', start: 1, end: 1, score: 1 }],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
          if (params?.signal?.aborted) {
            throw createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
          }
          return {
            backend: 'memory',
            code: [{ id: 'hit-b', file: 'src/b.js', start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };

        await assert.rejects(
          runFederatedSearch({
            workspacePath,
            query: 'abort-cache',
            search: { mode: 'code', top: 5 },
            limits: { concurrency: 1 }
          }, {
            signal: controller.signal,
            searchFn
          }),
          (error) => {
            assert.equal(error?.code, ERROR_CODES.CANCELLED);
            return true;
          }
        );

        const successful = await runFederatedSearch({
          workspacePath,
          query: 'abort-cache',
          search: { mode: 'code', top: 5 },
          limits: { concurrency: 1 }
        }, { searchFn });

        assert.equal(searchCalls, 4);
        assert.equal(successful.code.length, 2);
      });
    }
  },
  {
    name: 'non-strict mode still propagates hard failures after all repos are attempted',
    async run() {
      await withTempRoot('poc-fed-cache-hard-fail-', async ({ tempRoot, cacheRoot }) => {
        const repoMissing = path.join(tempRoot, 'repo-missing');
        const repoBroken = path.join(tempRoot, 'repo-broken');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo(repoMissing, cacheRoot);
        await writeRepo(repoBroken, cacheRoot);
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-missing", "alias": "missing", "priority": 10 },
    { "root": "./repo-broken", "alias": "broken", "priority": 5 }
  ]
}`, 'utf8');

        let searchCalls = 0;
        const searchFn = async (repoRootCanonical) => {
          searchCalls += 1;
          const leaf = path.basename(repoRootCanonical);
          if (leaf === 'repo-missing') {
            throw createError(ERROR_CODES.NO_INDEX, 'Index not found');
          }
          throw createError(ERROR_CODES.INTERNAL, 'Backend unavailable');
        };

        await assert.rejects(
          runFederatedSearch({
            workspacePath,
            query: 'federated',
            search: { mode: 'code', top: 5 },
            limits: { perRepoTop: 5, concurrency: 2 }
          }, { searchFn }),
          (error) => {
            assert.equal(error?.code, ERROR_CODES.INTERNAL);
            assert.match(String(error?.message || ''), /backend unavailable/i);
            return true;
          }
        );

        assert.equal(searchCalls, 2);
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('federation cache and failure contract matrix test passed');
