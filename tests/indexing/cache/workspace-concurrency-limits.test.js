#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-concurrency-'));
const cacheRoot = path.join(tempRoot, 'cache');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
const repoCount = 8;

const repos = [];
for (let i = 0; i < repoCount; i += 1) {
  const repoRoot = path.join(tempRoot, `repo-${i}`);
  repos.push(repoRoot);
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
    compatibilityKey: 'compat-concurrency'
  }, null, 2), 'utf8');
}

const workspaceRepos = repos.map((repoRoot, index) => (
  `{ "root": "./${path.basename(repoRoot)}", "alias": "r${index}", "priority": ${index} }`
));
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    ${workspaceRepos.join(',\n    ')}
  ]
}`, 'utf8');

let inFlight = 0;
let maxInFlight = 0;
let callCount = 0;
const searchFn = async (repoRootCanonical) => {
  callCount += 1;
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 35));
  inFlight -= 1;
  return {
    backend: 'memory',
    code: [
      {
        id: `hit-${path.basename(repoRootCanonical)}`,
        file: `src/${path.basename(repoRootCanonical)}.js`,
        start: 1,
        end: 1,
        score: 1
      }
    ],
    prose: [],
    extractedProse: [],
    records: []
  };
};

const response = await runFederatedSearch({
  workspacePath,
  query: 'concurrency',
  search: {
    mode: 'code',
    top: 20
  },
  limits: {
    perRepoTop: 5,
    concurrency: 2
  }
}, { searchFn });

assert.equal(callCount, repoCount, 'all selected repos should execute search fanout');
assert.ok(maxInFlight <= 2, `expected fanout concurrency <= 2, observed ${maxInFlight}`);
assert.equal(response.meta?.limits?.concurrency, 2);
assert.equal(Array.isArray(response.repos), true);
assert.equal(response.repos.length, repoCount);

console.log('workspace concurrency limits test passed');
