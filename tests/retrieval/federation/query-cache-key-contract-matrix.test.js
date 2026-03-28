#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import {
  buildFederatedQueryCacheKey,
  buildFederatedQueryCacheKeyPayload,
  findFederatedQueryCacheEntry,
  loadFederatedQueryCache,
  persistFederatedQueryCache,
  upsertFederatedQueryCacheEntry
} from '../../../src/retrieval/federation/query-cache.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const withTempWorkspace = async (prefix, build) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await build(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

const writeRepo = async ({ repoRoot, cacheRoot, modes = ['code'] }) => {
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

const cases = [
  {
    name: 'manifest hash participates in federated query cache invalidation',
    async run() {
      await withTempWorkspace('pairofcleats-fed-cache-manifest-', async (tempRoot) => {
        const cachePath = path.join(tempRoot, 'queryCache.json');
        const repoSetId = 'ws1-demo';

        const payload = buildFederatedQueryCacheKeyPayload({
          repoSetId,
          manifestHash: 'wm1-a',
          query: 'needle',
          selection: {
            selectedRepoIds: ['repo-a']
          },
          cohorts: {
            policy: 'default',
            modeSelections: { code: null }
          },
          search: { mode: 'code', top: 10 },
          merge: { strategy: 'rrf', rrfK: 60 },
          limits: { top: 10, perRepoTop: 20, concurrency: 2 }
        });
        const keyInfo = buildFederatedQueryCacheKey(payload);

        const cache = await loadFederatedQueryCache({ cachePath, repoSetId });
        upsertFederatedQueryCacheEntry(cache, {
          keyHash: keyInfo.keyHash,
          keyPayloadHash: keyInfo.keyPayloadHash,
          manifestHash: 'wm1-a',
          result: { ok: true, backend: 'federated', code: [], prose: [], extractedProse: [], records: [] }
        });
        await persistFederatedQueryCache({ cachePath, cache });

        const loaded = await loadFederatedQueryCache({ cachePath, repoSetId });
        assert.ok(findFederatedQueryCacheEntry(loaded, {
          keyHash: keyInfo.keyHash,
          manifestHash: 'wm1-a'
        }));
        assert.equal(findFederatedQueryCacheEntry(loaded, {
          keyHash: keyInfo.keyHash,
          manifestHash: 'wm1-b'
        }), null);
      });
    }
  },
  {
    name: 'key payload normalization is byte-stable and sensitive to workspace metadata',
    async run() {
      const payloadA = buildFederatedQueryCacheKeyPayload({
        repoSetId: 'ws1-demo',
        manifestHash: 'wm1-alpha',
        query: 'greet',
        workspace: { configHash: 'wsc1-alpha' },
        selection: {
          selectedRepoIds: ['repo-b', 'repo-a'],
          selectedRepoPriorities: ['repo-b:5', 'repo-a:10'],
          includeDisabled: false,
          tags: ['service', 'api'],
          repoFilter: ['repo-*', 'svc-*'],
          explicitSelects: ['repo-b', 'repo-a']
        },
        cohorts: {
          policy: 'default',
          modeSelections: { code: 'cohort-a', prose: 'cohort-a' },
          excluded: {
            code: [{ repoId: 'repo-c', effectiveKey: 'cohort-b', reason: 'cohort-excluded' }]
          }
        },
        cohortSelectors: ['code:cohort-a'],
        search: { mode: 'code', top: 10, backend: 'auto' },
        merge: { strategy: 'rrf', rrfK: 60 },
        limits: { top: 10, perRepoTop: 20, concurrency: 4 },
        runtime: { perRepoArgs: ['--json', '--compact', '--top', '20'], requestedBackend: 'auto' }
      });
      const payloadB = buildFederatedQueryCacheKeyPayload({
        repoSetId: 'ws1-demo',
        manifestHash: 'wm1-alpha',
        query: 'greet',
        workspace: { configHash: 'wsc1-alpha' },
        selection: {
          selectedRepoIds: ['repo-a', 'repo-b'],
          selectedRepoPriorities: ['repo-a:10', 'repo-b:5'],
          includeDisabled: false,
          tags: ['api', 'service'],
          repoFilter: ['svc-*', 'repo-*'],
          explicitSelects: ['repo-a', 'repo-b']
        },
        cohorts: {
          policy: 'default',
          modeSelections: { prose: 'cohort-a', code: 'cohort-a' },
          excluded: {
            code: [{ reason: 'cohort-excluded', effectiveKey: 'cohort-b', repoId: 'repo-c' }]
          }
        },
        cohortSelectors: ['code:cohort-a'],
        search: { backend: 'auto', top: 10, mode: 'code' },
        merge: { rrfK: 60, strategy: 'rrf' },
        limits: { concurrency: 4, perRepoTop: 20, top: 10 },
        runtime: { requestedBackend: 'auto', perRepoArgs: ['--json', '--compact', '--top', '20'] }
      });
      const keyA = buildFederatedQueryCacheKey(payloadA);
      const keyB = buildFederatedQueryCacheKey(payloadB);
      assert.equal(stableStringify(payloadA), stableStringify(payloadB));
      assert.equal(keyA.keyHash, keyB.keyHash);
      assert.equal(keyA.keyPayloadHash, keyB.keyPayloadHash);

      const payloadC = buildFederatedQueryCacheKeyPayload({
        ...payloadA,
        selection: {
          ...payloadA.selection,
          selectedRepoPriorities: ['repo-a:2', 'repo-b:1']
        }
      });
      const payloadD = buildFederatedQueryCacheKeyPayload({
        ...payloadA,
        workspace: { configHash: 'wsc1-beta' }
      });
      assert.notEqual(keyA.keyHash, buildFederatedQueryCacheKey(payloadC).keyHash);
      assert.notEqual(keyA.keyHash, buildFederatedQueryCacheKey(payloadD).keyHash);
    }
  },
  {
    name: 'workspace metadata changes invalidate federated cache entries',
    async run() {
      await withTempWorkspace('pairofcleats-fed-cache-workspace-meta-', async (tempRoot) => {
        const cacheRoot = path.join(tempRoot, 'cache');
        const repoRoot = path.join(tempRoot, 'repo');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo({ repoRoot, cacheRoot });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "name": "Workspace Alpha",
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "alpha" }
  ]
}`, 'utf8');
        let searchCalls = 0;
        const searchFn = async () => {
          searchCalls += 1;
          return {
            backend: 'memory',
            code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };
        const first = await runFederatedSearch({
          workspacePath,
          query: 'cache-workspace-meta',
          search: { mode: 'code', top: 5 }
        }, { searchFn });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "name": "Workspace Beta",
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "beta" }
  ]
}`, 'utf8');
        const second = await runFederatedSearch({
          workspacePath,
          query: 'cache-workspace-meta',
          search: { mode: 'code', top: 5 }
        }, { searchFn });
        assert.equal(searchCalls, 2);
        assert.equal(first.meta?.workspace?.name, 'Workspace Alpha');
        assert.equal(second.meta?.workspace?.name, 'Workspace Beta');
        assert.equal(first.code[0]?.repoAlias, 'alpha');
        assert.equal(second.code[0]?.repoAlias, 'beta');
      });
    }
  },
  {
    name: 'strict mode does not reuse non-strict cache entries',
    async run() {
      await withTempWorkspace('pairofcleats-fed-strict-cache-key-', async (tempRoot) => {
        const cacheRoot = path.join(tempRoot, 'cache');
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo({ repoRoot: repoA, cacheRoot });
        await writeRepo({ repoRoot: repoB, cacheRoot });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "a", "priority": 10 },
    { "root": "./repo-b", "alias": "b", "priority": 1 }
  ]
}`, 'utf8');
        let searchCalls = 0;
        const searchFn = async (repoRootCanonical) => {
          searchCalls += 1;
          if (path.basename(repoRootCanonical) === 'repo-a') {
            throw createError(ERROR_CODES.NO_INDEX, 'missing index for strict cache-key test');
          }
          return {
            backend: 'memory',
            code: [{ id: 'hit-b', file: 'src/b.js', start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };
        const baseRequest = {
          workspacePath,
          query: 'strict-cache-key-separation',
          search: { mode: 'code', top: 5 },
          limits: { concurrency: 1 }
        };
        const nonStrict = await runFederatedSearch(baseRequest, { searchFn });
        assert.equal(nonStrict.ok, true);
        assert.equal(nonStrict.code.length, 1);
        await assert.rejects(
          runFederatedSearch({ ...baseRequest, strict: true }, { searchFn }),
          (error) => error?.code === ERROR_CODES.NO_INDEX
        );
        assert.ok(searchCalls >= 3);
      });
    }
  },
  {
    name: 'object-only select does not fragment equivalent cache keys',
    async run() {
      await withTempWorkspace('pairofcleats-fed-select-object-no-fragment-', async (tempRoot) => {
        const cacheRoot = path.join(tempRoot, 'cache');
        const repoRoot = path.join(tempRoot, 'repo');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo({ repoRoot, cacheRoot });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample", "enabled": false }
  ]
}`, 'utf8');
        let searchCalls = 0;
        const searchFn = async () => {
          searchCalls += 1;
          return {
            backend: 'memory',
            code: [{ id: 'hit-1', file: 'src/app.js', start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };
        const first = await runFederatedSearch({
          workspacePath,
          query: 'select-object-only',
          search: { mode: 'code', top: 5 },
          select: { includeDisabled: true }
        }, { searchFn });
        assert.equal(first.ok, true);
        assert.deepEqual(first.meta?.selection?.explicitSelects || [], []);
        assert.equal(first.code.length, 1);
        const second = await runFederatedSearch({
          workspacePath,
          query: 'select-object-only',
          search: { mode: 'code', top: 5 },
          includeDisabled: true
        }, { searchFn });
        assert.equal(second.ok, true);
        assert.equal(second.code.length, 1);
        assert.equal(searchCalls, 1);
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('federated query cache key contract matrix test passed');
