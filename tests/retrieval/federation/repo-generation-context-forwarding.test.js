#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';

import { applyTestEnv } from '../../helpers/test-env.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-generation-context-'));
const cacheRoot = path.join(tempRoot, 'cache');
applyTestEnv({ cacheRoot });
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-ctx');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  buildId: 'build-ctx',
  buildRoot,
  buildRootsByMode: { code: buildRoot },
  modes: ['code']
}, null, 2), 'utf8');
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  compatibilityKey: 'compat-code'
}, null, 2), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "alpha" }
  ]
}`, 'utf8');

let capturedGenerationContext = null;
const admitted = (await generateWorkspaceManifest(loadWorkspaceConfig(workspacePath), { write: false })).manifest.repos[0];
const response = await runFederatedSearch({
  workspacePath,
  query: 'generation-context-forwarding',
  debug: { includePaths: true },
  search: { mode: 'code', top: 5 }
}, {
  resolveRepoCaches: async () => ({
    indexCache: { get: () => null, set: () => {}, delete: () => {}, clear: () => {}, size: () => 0, cache: null },
    sqliteCache: null,
    buildId: 'build-ctx',
    buildRoot,
    activeBuildRoot: buildRoot,
    buildGenerationKey: admitted.build.generationKey
  }),
  searchFn: async (_repoRootCanonical, params) => {
    capturedGenerationContext = params.generationContext || null;
    return {
      backend: 'memory',
      code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.equal(capturedGenerationContext?.buildId, 'build-ctx');
assert.equal(capturedGenerationContext?.activeBuildRoot, buildRoot);
assert.equal(capturedGenerationContext?.buildGenerationKey, admitted.build.generationKey);
assert.equal(response.repos[0]?.freshness?.buildId, 'build-ctx');
assert.ok(response.repos[0]?.freshness?.generationKey, 'expected freshness generation key in response');
assert.equal(capturedGenerationContext?.buildGenerationKey, response.repos[0].freshness.generationKey);
assert.equal(capturedGenerationContext?.activeBuildRoot, response.repos[0].freshness.activeBuildRoot);

let searched = false;
await assert.rejects(runFederatedSearch({ workspacePath, query: 'generation-mismatch', search: { mode: 'code' } }, {
  resolveRepoCaches: async () => ({ buildId: 'build-other', buildGenerationKey: 'other-generation' }),
  searchFn: async () => { searched = true; return { code: [] }; }
}), { code: 'INVALID_REQUEST' });
assert.equal(searched, false, 'host generation mismatch rejects before any child read');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('federated repo generation context forwarding test passed');
