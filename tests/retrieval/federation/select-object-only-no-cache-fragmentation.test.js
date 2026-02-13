#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-select-object-no-fragment-'));
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
assert.deepEqual(
  first.meta?.selection?.explicitSelects || [],
  [],
  'object-only select must not be coerced into explicit select tokens'
);
assert.equal(first.code.length, 1);

const second = await runFederatedSearch({
  workspacePath,
  query: 'select-object-only',
  search: { mode: 'code', top: 5 },
  includeDisabled: true
}, { searchFn });
assert.equal(second.ok, true);
assert.equal(second.code.length, 1);
assert.equal(searchCalls, 1, 'equivalent requests should reuse federated cache key');

console.log('federated object-only select cache-key stability test passed');
