import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';
import { buildFederatedQueryCacheKey, buildFederatedQueryCacheKeyPayload } from '../../../src/retrieval/federation/query-cache.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-child-generation-'));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, embeddings: 'off' });
try {
  const repoRoot = path.join(root, 'repo');
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const builds = {};
  for (const buildId of ['build-a', 'build-b']) {
    const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot, modes, buildId });
    builds[buildId] = descriptor;
    for (const mode of modes) {
      const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { mode, compatibilityKey: `cohort-${buildId}` });
      await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{
        id: 0, chunkUid: `${buildId}:${mode}`, file: `${mode}.js`, name: buildId,
        kind: 'FunctionDeclaration', start: 0, end: 1, tokens: ['alpha'], text: 'alpha'
      }]));
      const statePath = path.join(indexDir, 'index_state.json');
      await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath, 'utf8')), buildId }));
    }
  }
  const pointerPath = path.join(builds['build-a'].repoCacheRoot, 'builds', 'current.json');
  const fixedTime = new Date('2026-10-01T00:00:00.000Z');
  const select = async buildId => {
    await fs.writeFile(pointerPath, JSON.stringify(builds[buildId].buildPointer));
    await fs.utimes(pointerPath, fixedTime, fixedTime);
  };
  await select('build-a');
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [{ root: './repo' }] }));
  const workspace = loadWorkspaceConfig(workspacePath);
  const admitted = (await generateWorkspaceManifest(workspace, { write: false })).manifest;
  const admittedBuild = admitted.repos[0].build;

  for (const shape of ['ranked-code', 'ranked-all', 'enumeration']) {
    const request = { workspacePath, strict: true,
      ...(shape === 'enumeration' ? {} : { query: 'alpha' }),
      search: { backend: 'memory', mode: shape === 'ranked-all' ? 'all' : 'code',
        ...(shape === 'enumeration' ? { type: 'FunctionDeclaration' } : {}), top: 2 } };
    let searchedGeneration;
    const pinned = await runFederatedSearch(request, {
      // This host correctly reports A before the child starts. The actual child
      // then sees B as current, while its explicit admitted build remains A.
      ...(shape === 'ranked-all' ? { resolveRepoCaches: async () => ({ buildId: admittedBuild.buildId,
        activeBuildRoot: admittedBuild.activeRoot, buildGenerationKey: admittedBuild.generationKey }) } : {}),
      searchFn: async (...args) => {
        await select('build-b');
        try {
          const result = await coreSearch(...args);
          assert.ok(result.code.length > 0, 'the actual core search must read the promoted tiny index');
          assert.equal(result.code[0].name, 'build-a');
          assert.equal(result.asOf.ref, 'build:build-a');
          searchedGeneration = result.retrieval.freshness.byMode.code.buildId;
          return result;
        } finally { await select('build-a'); }
      }
    });
    assert.equal(pinned.code[0].name, 'build-a');
    assert.equal(searchedGeneration, 'build-a');
    assert.equal((await generateWorkspaceManifest(workspace, { write: false })).manifest.manifestHash,
      admitted.manifestHash, 'the returned pointer and manifest retain the same identity');

    const forged = { ...request, search: { ...request.search, output: 'full' } };
    await assert.rejects(runFederatedSearch(forged, { searchFn: async (...args) => {
      const result = structuredClone(await coreSearch(...args));
      result.retrieval.freshness.byMode.code.signature = 'different-selected-source';
      return result;
    } }), error => {
      assert.equal(error.code, 'INVALID_REQUEST');
      assert.match(error.message, /generation does not match workspace admission/);
      return true;
    });
    let calls = 0;
    const healthy = await runFederatedSearch(forged, { searchFn: async (...args) => { calls++; return coreSearch(...args); } });
    assert.equal(calls, 1, 'a rejected child generation must never populate the outer result cache');
    assert.equal(healthy.code[0].name, 'build-a');
    assert.equal(healthy.meta.manifestHash, admitted.manifestHash);
    assert.equal(healthy.repos[0].freshness?.buildId || (shape === 'enumeration' ? 'build-a' : null), 'build-a');
  }
  const payload = buildFederatedQueryCacheKeyPayload({ query: 'alpha' });
  assert.notEqual(buildFederatedQueryCacheKey(payload).keyHash, buildFederatedQueryCacheKey({ ...payload, v: 6 }).keyHash,
    'pre-root-pinning results cannot bypass the new generation boundary through a cache hit');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Core federated children prove admitted mode signatures before ranked/enumeration publication, including returned-pointer races.');
