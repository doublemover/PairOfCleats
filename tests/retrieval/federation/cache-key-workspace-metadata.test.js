#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-cache-workspace-meta-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
const codeIndexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(codeIndexDir, { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'test-build',
  buildRoot,
  modes: ['code']
}, null, 2), 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-code'
}, null, 2), 'utf8');

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

assert.equal(searchCalls, 2, 'workspace metadata changes should invalidate federated query cache entries');
assert.equal(first.meta?.workspace?.name, 'Workspace Alpha');
assert.equal(second.meta?.workspace?.name, 'Workspace Beta');
assert.equal(first.code[0]?.repoAlias, 'alpha');
assert.equal(second.code[0]?.repoAlias, 'beta');

console.log('federated cache key workspace metadata test passed');
