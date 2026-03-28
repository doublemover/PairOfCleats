#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveIndexRef } from '../../../src/index/index-ref.js';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { runFederatedSearch, mergeFederatedResultsByMode } from '../../../src/retrieval/federation/coordinator.js';
import { selectWorkspaceRepos } from '../../../src/retrieval/federation/select.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

applyTestEnv();

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
    name: 'explicit snapshot refs fail fast instead of falling back to latest',
    async run() {
      await withTempRoot('poc-fed-select-explicit-root-', async ({ tempRoot, cacheRoot }) => {
        const repoRoot = path.join(tempRoot, 'repo');
        const userConfig = { cache: { root: cacheRoot } };
        await fs.mkdir(repoRoot, { recursive: true });

        const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
        const buildsRoot = path.join(repoCacheRoot, 'builds');
        const liveBuildRoot = path.join(buildsRoot, 'build-live');
        await fs.mkdir(liveBuildRoot, { recursive: true });

        const writeJson = async (targetPath, value) => {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        };

        await writeJson(path.join(liveBuildRoot, 'build_state.json'), {
          schemaVersion: 1,
          buildId: 'build-live',
          configHash: 'cfg-live',
          tool: { version: '1.0.0' }
        });
        await writeJson(path.join(buildsRoot, 'current.json'), {
          buildRoot: 'builds/build-live',
          buildRootsByMode: { code: 'builds/build-live' }
        });

        const snapshotId = 'snap-20260212-explicit-nofallback';
        const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');
        await writeJson(path.join(snapshotsRoot, 'manifest.json'), {
          version: 1,
          updatedAt: '2026-02-12T00:00:00.000Z',
          snapshots: {
            [snapshotId]: {
              snapshotId,
              createdAt: '2026-02-12T00:00:00.000Z',
              hasFrozen: false
            }
          },
          tags: {}
        });
        await writeJson(path.join(snapshotsRoot, snapshotId, 'snapshot.json'), {
          version: 1,
          snapshotId,
          kind: 'pointer',
          pointer: {
            buildRootsByMode: { code: 'builds/missing-build-root' },
            buildIdByMode: { code: 'build-missing' }
          }
        });

        assert.throws(
          () => resolveIndexRef({
            ref: `snap:${snapshotId}`,
            repoRoot,
            userConfig,
            requestedModes: ['code']
          }),
          /missing build root/i
        );

        const latest = resolveIndexRef({
          ref: 'latest',
          repoRoot,
          userConfig,
          requestedModes: ['code']
        });
        assert.equal(latest.indexBaseRootByMode.code, liveBuildRoot);
      });
    }
  },
  {
    name: 'invalid cohort selectors keep the dedicated client-error code',
    async run() {
      await withTempRoot('poc-fed-select-invalid-cohort-', async ({ tempRoot, cacheRoot }) => {
        const repoRoot = path.join(tempRoot, 'repo');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo({ repoRoot, cacheRoot, modes: ['code'] });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

        await assert.rejects(
          runFederatedSearch({
            workspacePath,
            query: 'bad-selector',
            cohort: ['code:'],
            search: { mode: 'code', top: 5 }
          }),
          (error) => {
            assert.equal(error?.code, 'ERR_FEDERATED_INVALID_COHORT_SELECTOR');
            return true;
          }
        );

        await assert.rejects(
          runFederatedSearch({
            workspacePath,
            query: 'multi-global',
            cohort: ['c1', 'c2'],
            search: { mode: 'code', top: 5 }
          }),
          (error) => {
            assert.equal(error?.code, 'ERR_FEDERATED_INVALID_COHORT_SELECTOR');
            return true;
          }
        );
      });
    }
  },
  {
    name: 'mode cohort merge cutoff honors per-mode selected repos',
    run() {
      const perRepoResults = [
        {
          repoId: 'repo-high',
          repoAlias: 'high',
          priority: 100,
          result: {
            code: [{ id: 'high-code', file: 'src/high.js', start: 1, end: 1, score: 1 }],
            prose: [{ id: 'high-prose', file: 'docs/high.md', start: 1, end: 1, score: 1 }],
            extractedProse: [],
            records: []
          }
        },
        {
          repoId: 'repo-low',
          repoAlias: 'low',
          priority: 1,
          result: {
            code: [{ id: 'low-code', file: 'src/low.js', start: 1, end: 1, score: 1 }],
            prose: [{ id: 'low-prose', file: 'docs/low.md', start: 1, end: 1, score: 1 }],
            extractedProse: [],
            records: []
          }
        }
      ];

      const merged = mergeFederatedResultsByMode({
        perRepoResults,
        selectedReposByMode: {
          code: [{ repoId: 'repo-low' }],
          prose: [{ repoId: 'repo-high' }],
          'extracted-prose': [],
          records: []
        },
        topN: 1,
        perRepoTop: 10,
        rrfK: 60
      });

      assert.deepEqual(merged.code.map((hit) => hit.repoId), ['repo-low']);
      assert.deepEqual(merged.prose.map((hit) => hit.repoId), ['repo-high']);
      assert.deepEqual(merged.extractedProse, []);
      assert.deepEqual(merged.records, []);
    }
  },
  {
    name: 'workspace repo selection remains deterministic across explicit, tag, and glob filters',
    run() {
      const workspaceConfig = {
        repos: [
          {
            repoId: 'repo-a',
            alias: 'alpha',
            repoRootCanonical: '/tmp/repo-a',
            enabled: true,
            priority: 2,
            tags: ['service', 'api']
          },
          {
            repoId: 'repo-b',
            alias: 'beta',
            repoRootCanonical: '/tmp/repo-b',
            enabled: false,
            priority: 100,
            tags: ['batch']
          },
          {
            repoId: 'repo-c',
            alias: 'gamma',
            repoRootCanonical: '/tmp/repo-c',
            enabled: true,
            priority: 1,
            tags: ['service']
          }
        ]
      };

      const explicitDisabled = selectWorkspaceRepos({
        workspaceConfig,
        select: ['beta'],
        includeDisabled: false
      });
      assert.ok(explicitDisabled.selectedRepos.some((repo) => repo.repoId === 'repo-b'));

      const tagged = selectWorkspaceRepos({
        workspaceConfig,
        tag: ['service']
      });
      assert.deepEqual(tagged.selectedRepos.map((repo) => repo.repoId), ['repo-a', 'repo-c']);

      const filtered = selectWorkspaceRepos({
        workspaceConfig,
        includeDisabled: true,
        repoFilter: ['repo-*']
      });
      assert.deepEqual(filtered.selectedRepos.map((repo) => repo.repoId), ['repo-b', 'repo-a', 'repo-c']);
    }
  },
  {
    name: 'selection aliases and per-repo mode eligibility fan out correctly',
    async run() {
      await withTempRoot('poc-fed-select-aliases-eligibility-', async ({ tempRoot, cacheRoot }) => {
        const repoAliasA = path.join(tempRoot, 'repo-a');
        const repoAliasB = path.join(tempRoot, 'repo-b');
        const aliasWorkspacePath = path.join(tempRoot, '.pairofcleats-workspace-aliases.jsonc');
        await writeRepo({ repoRoot: repoAliasA, cacheRoot, modes: ['code'] });
        await writeRepo({ repoRoot: repoAliasB, cacheRoot, modes: ['code'] });

        await fs.writeFile(aliasWorkspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha", "tags": ["service"], "priority": 10 },
    { "root": "./repo-b", "alias": "beta", "tags": ["batch"], "priority": 5 }
  ]
}`, 'utf8');

        const selectedByTagAlias = [];
        await runFederatedSearch({
          workspacePath: aliasWorkspacePath,
          query: 'alias-tag-query',
          search: { mode: 'code' },
          select: { tag: ['service'] }
        }, {
          searchFn: async (repoRootCanonical) => {
            selectedByTagAlias.push(path.basename(repoRootCanonical));
            return { backend: 'memory', code: [], prose: [], extractedProse: [], records: [] };
          }
        });
        assert.deepEqual(selectedByTagAlias, ['repo-a']);

        const selectedByRepoFilterAlias = [];
        await runFederatedSearch({
          workspacePath: aliasWorkspacePath,
          query: 'alias-repo-filter-query',
          search: { mode: 'code' },
          select: { 'repo-filter': ['beta'] }
        }, {
          searchFn: async (repoRootCanonical) => {
            selectedByRepoFilterAlias.push(path.basename(repoRootCanonical));
            return { backend: 'memory', code: [], prose: [], extractedProse: [], records: [] };
          }
        });
        assert.deepEqual(selectedByRepoFilterAlias, ['repo-b']);

        const repoCode = path.join(tempRoot, 'repo-code');
        const repoProse = path.join(tempRoot, 'repo-prose');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace-modes.jsonc');
        await writeRepo({ repoRoot: repoCode, cacheRoot, modes: ['code'] });
        await writeRepo({ repoRoot: repoProse, cacheRoot, modes: ['prose'] });
        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-code", "alias": "alpha", "tags": ["service"], "priority": 10 },
    { "root": "./repo-prose", "alias": "beta", "tags": ["batch"], "priority": 5 }
  ]
}`, 'utf8');

        const request = parseFederatedCliRequest([
          'federated-per-repo-mode',
          '--workspace',
          workspacePath,
          '--mode',
          'both',
          '--top',
          '5'
        ]);
        const searchCalls = [];
        const getModeFromArgs = (args = []) => {
          for (let i = 0; i < args.length; i += 1) {
            const token = String(args[i] || '');
            if (token === '--mode') return String(args[i + 1] || '').trim().toLowerCase();
            if (token.startsWith('--mode=')) return token.slice('--mode='.length).trim().toLowerCase();
          }
          return '';
        };

        const response = await runFederatedSearch(request, {
          searchFn: async (repoRootCanonical, params) => {
            const leaf = path.basename(repoRootCanonical);
            const mode = getModeFromArgs(params?.args);
            searchCalls.push({ leaf, mode });
            if (leaf === 'repo-code') {
              assert.equal(mode, 'code');
              return {
                backend: 'memory',
                code: [{ id: 'code-hit', file: 'src/code.js', start: 1, end: 1, score: 1 }],
                prose: [],
                extractedProse: [],
                records: []
              };
            }
            assert.equal(mode, 'prose');
            return {
              backend: 'memory',
              code: [],
              prose: [{ id: 'prose-hit', file: 'docs/prose.md', start: 1, end: 1, score: 1 }],
              extractedProse: [],
              records: []
            };
          }
        });

        assert.equal(response.ok, true);
        assert.equal(response.code.length, 1);
        assert.equal(response.prose.length, 1);
        const callsByRepo = new Map(searchCalls.map((entry) => [entry.leaf, entry.mode]));
        assert.equal(callsByRepo.get('repo-code'), 'code');
        assert.equal(callsByRepo.get('repo-prose'), 'prose');
      });
    }
  },
  {
    name: 'validated workspace snapshots are reused while trust boundaries reject mismatched trusted configs',
    async run() {
      await withTempRoot('poc-fed-select-workspace-', async ({ tempRoot, cacheRoot }) => {
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePathPrimary = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        const workspacePathAlt = path.join(tempRoot, '.pairofcleats-workspace-alt.jsonc');

        await writeRepo({ repoRoot: repoA, cacheRoot, modes: ['code'] });
        await writeRepo({ repoRoot: repoB, cacheRoot, modes: ['code'] });

        await fs.writeFile(workspacePathPrimary, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha" }
  ]
}`, 'utf8');
        const validatedWorkspaceConfig = loadWorkspaceConfig(workspacePathPrimary);

        await fs.writeFile(workspacePathPrimary, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-b", "alias": "beta" }
  ]
}`, 'utf8');

        const searchedSnapshotRepos = [];
        const snapshotResponse = await runFederatedSearch({
          workspacePath: workspacePathPrimary,
          workspaceConfig: validatedWorkspaceConfig,
          query: 'snapshot',
          search: { mode: 'code', top: 5 }
        }, {
          trustedWorkspaceConfig: true,
          searchFn: async (repoRootCanonical) => {
            searchedSnapshotRepos.push(path.basename(repoRootCanonical));
            return {
              backend: 'memory',
              code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
        });

        assert.deepEqual(searchedSnapshotRepos, ['repo-a']);
        assert.equal(snapshotResponse.code[0]?.repoAlias, 'alpha');

        await fs.writeFile(workspacePathPrimary, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-b", "alias": "beta" }
  ]
}`, 'utf8');
        await fs.writeFile(workspacePathAlt, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha" }
  ]
}`, 'utf8');

        const alternateConfig = loadWorkspaceConfig(workspacePathAlt);
        const searchedUntrustedRepos = [];
        await runFederatedSearch({
          workspacePath: workspacePathPrimary,
          workspaceConfig: alternateConfig,
          query: 'trust-boundary',
          search: { mode: 'code', top: 5 }
        }, {
          searchFn: async (repoRootCanonical) => {
            searchedUntrustedRepos.push(path.basename(repoRootCanonical));
            return {
              backend: 'memory',
              code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
              prose: [],
              extractedProse: [],
              records: []
            };
          }
        });
        assert.deepEqual(searchedUntrustedRepos, ['repo-b']);

        await assert.rejects(
          runFederatedSearch({
            workspacePath: workspacePathPrimary,
            workspaceConfig: alternateConfig,
            query: 'trust-boundary',
            search: { mode: 'code', top: 5 }
          }, {
            trustedWorkspaceConfig: true,
            searchFn: async () => ({
              backend: 'memory',
              code: [],
              prose: [],
              extractedProse: [],
              records: []
            })
          }),
          (error) => {
            assert.equal(error?.code, ERROR_CODES.INVALID_REQUEST);
            assert.match(String(error?.message || ''), /workspacepath does not match/i);
            return true;
          }
        );
      });
    }
  },
  {
    name: 'multi-repo responses stay deterministic across repeated runs',
    async run() {
      await withTempRoot('poc-fed-select-determinism-', async ({ tempRoot, cacheRoot }) => {
        const repoA = path.join(tempRoot, 'repo-a');
        const repoB = path.join(tempRoot, 'repo-b');
        const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
        await writeRepo({ repoRoot: repoA, cacheRoot, modes: ['code'] });
        await writeRepo({ repoRoot: repoB, cacheRoot, modes: ['code'] });

        await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha", "priority": 5 },
    { "root": "./repo-b", "alias": "beta", "priority": 5 }
  ]
}`, 'utf8');

        const searchFn = async (repoRootCanonical) => {
          if (path.basename(repoRootCanonical) === 'repo-b') {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return {
            backend: 'memory',
            code: [{ id: 'shared-id', file: 'src/shared.js', start: 1, end: 1, score: 1 }],
            prose: [],
            extractedProse: [],
            records: []
          };
        };

        const request = {
          workspacePath,
          query: 'deterministic',
          search: { mode: 'code', top: 2 },
          limits: { perRepoTop: 2, concurrency: 2 }
        };

        const first = await runFederatedSearch(request, { searchFn });
        const second = await runFederatedSearch(request, { searchFn });
        assert.equal(stableStringify(first), stableStringify(second));
      });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('federation selection contract matrix test passed');
