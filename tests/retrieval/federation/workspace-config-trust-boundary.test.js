#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-workspace-trust-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspacePathPrimary = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
const workspacePathAlt = path.join(tempRoot, '.pairofcleats-workspace-alt.jsonc');

const writeRepoWithCodeIndex = async (repoRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'test-build',
    buildRoot,
    modes: ['code']
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
    compatibilityKey: 'compat-code'
  }, null, 2), 'utf8');
};

await writeRepoWithCodeIndex(repoA);
await writeRepoWithCodeIndex(repoB);

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

const searchedRepos = [];
await runFederatedSearch({
  workspacePath: workspacePathPrimary,
  workspaceConfig: alternateConfig,
  query: 'trust-boundary',
  search: { mode: 'code', top: 5 }
}, {
  // Without trustedWorkspaceConfig, request.workspaceConfig must be ignored.
  searchFn: async (repoRootCanonical) => {
    searchedRepos.push(path.basename(repoRootCanonical));
    return {
      backend: 'memory',
      code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.deepEqual(
  searchedRepos,
  ['repo-b'],
  'untrusted request.workspaceConfig must not override workspacePath source'
);

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

console.log('federated workspace config trust boundary test passed');
