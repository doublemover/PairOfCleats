#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-workspace-snapshot-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

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

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha" }
  ]
}`, 'utf8');

const validatedWorkspaceConfig = loadWorkspaceConfig(workspacePath);

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-b", "alias": "beta" }
  ]
}`, 'utf8');

const searchedRepos = [];
const response = await runFederatedSearch({
  workspacePath,
  workspaceConfig: validatedWorkspaceConfig,
  query: 'snapshot',
  search: { mode: 'code', top: 5 }
}, {
  trustedWorkspaceConfig: true,
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
  ['repo-a'],
  'federated search should use validated workspace snapshot, not reloaded workspace file'
);
assert.equal(response.code[0]?.repoAlias, 'alpha');

console.log('federated workspace config snapshot test passed');
