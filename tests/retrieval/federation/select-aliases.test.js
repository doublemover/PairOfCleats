#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-select-aliases-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

const writeRepo = async (repoRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
};

await writeRepo(repoA);
await writeRepo(repoB);
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha", "tags": ["service"] },
    { "root": "./repo-b", "alias": "beta", "tags": ["batch"] }
  ]
}`, 'utf8');

const toLeaf = (repoRootCanonical) => path.basename(repoRootCanonical);
const emptyResult = {
  backend: 'memory',
  code: [],
  prose: [],
  extractedProse: [],
  records: []
};

const selectedByTagAlias = [];
await runFederatedSearch({
  workspacePath,
  query: 'alias-tag-query',
  search: { mode: 'code' },
  select: { tag: ['service'] }
}, {
  searchFn: async (repoRootCanonical) => {
    selectedByTagAlias.push(toLeaf(repoRootCanonical));
    return emptyResult;
  }
});
assert.deepEqual(
  selectedByTagAlias,
  ['repo-a'],
  'select.tag alias should be honored for workspace repo selection'
);

const selectedByRepoFilterAlias = [];
await runFederatedSearch({
  workspacePath,
  query: 'alias-repo-filter-query',
  search: { mode: 'code' },
  select: { 'repo-filter': ['beta'] }
}, {
  searchFn: async (repoRootCanonical) => {
    selectedByRepoFilterAlias.push(toLeaf(repoRootCanonical));
    return emptyResult;
  }
});
assert.deepEqual(
  selectedByRepoFilterAlias,
  ['repo-b'],
  'select[\'repo-filter\'] alias should be honored for workspace repo selection'
);

console.log('federation select aliases test passed');
