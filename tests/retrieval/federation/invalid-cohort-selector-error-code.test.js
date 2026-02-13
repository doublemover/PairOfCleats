#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-invalid-cohort-code-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

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

console.log('federated invalid cohort selector error code test passed');
