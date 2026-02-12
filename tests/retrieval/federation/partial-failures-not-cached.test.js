#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-partial-cache-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

const writeRepo = async (repoRoot, modes = ['code']) => {
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

await writeRepo(repoA);
await writeRepo(repoB);
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "a", "priority": 10 },
    { "root": "./repo-b", "alias": "b", "priority": 5 }
  ]
}`, 'utf8');

let searchCalls = 0;
const repoAttempts = new Map();
const searchFn = async (repoRootCanonical) => {
  searchCalls += 1;
  const leaf = path.basename(repoRootCanonical);
  const attempts = (repoAttempts.get(leaf) || 0) + 1;
  repoAttempts.set(leaf, attempts);
  if (leaf === 'repo-a' && attempts === 1) {
    throw createError(ERROR_CODES.NO_INDEX, 'simulated transient index miss');
  }
  return {
    backend: 'memory',
    code: [{ id: `hit-${leaf}`, file: `src/${leaf}.js`, start: 1, end: 1, score: 1 }],
    prose: [],
    extractedProse: [],
    records: []
  };
};

const baseRequest = {
  workspacePath,
  query: 'partial-failure-cache',
  search: { mode: 'code', top: 5 },
  limits: { concurrency: 1 }
};

const first = await runFederatedSearch(baseRequest, { searchFn });
assert.equal(first.ok, true);
assert.equal(first.code.length, 1, 'first request should succeed with partial results');
assert.ok(
  first.repos.some((entry) => entry.repoId && entry.status === 'missing_index'),
  'first request should record the repo failure'
);

const second = await runFederatedSearch(baseRequest, { searchFn });
assert.equal(second.ok, true);
assert.equal(second.code.length, 2, 'second request should re-run fanout and include recovered repo');
assert.equal(searchCalls, 4, 'partial first response should not be reused from cache');

console.log('federated partial failures should not be cached test passed');
