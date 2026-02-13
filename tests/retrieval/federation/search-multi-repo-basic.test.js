#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-basic-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const repoMissing = path.join(tempRoot, 'repo-missing');
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
await writeRepo(repoMissing);

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-a", "alias": "alpha", "priority": 10 },
    { "root": "./repo-b", "alias": "beta", "priority": 5 },
    { "root": "./repo-missing", "alias": "missing", "priority": 1 }
  ]
}`, 'utf8');

const searchFn = async (repoRootCanonical, params) => {
  const leaf = path.basename(repoRootCanonical);
  if (leaf === 'repo-missing') {
    throw createError(ERROR_CODES.NO_INDEX, 'Index not found');
  }
  return {
    backend: 'memory',
    code: [
      {
        id: `${leaf}-hit`,
        file: `src/${leaf}.js`,
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
  query: 'federated',
  search: { mode: 'code', top: 5 },
  limits: { perRepoTop: 4, concurrency: 2 }
}, { searchFn });

assert.equal(response.ok, true);
assert.equal(response.backend, 'federated');
assert.equal(Array.isArray(response.code), true);
assert.equal(response.code.length, 2, 'expected successful repos to contribute merged hits');
assert.deepEqual(
  response.code.map((hit) => hit.repoAlias),
  ['alpha', 'beta'],
  'merged order should honor deterministic tie-breakers'
);
for (const hit of response.code) {
  assert.ok(hit.repoId, 'hit.repoId should be present');
  assert.ok(hit.globalId && hit.globalId.includes(':'), 'hit.globalId should be present');
}

const diagnostics = Array.isArray(response.repos) ? response.repos : [];
assert.equal(diagnostics.length, 3, 'all selected repos should have diagnostics');
assert.deepEqual(
  diagnostics.map((entry) => entry.repoId),
  diagnostics.map((entry) => entry.repoId).slice().sort(),
  'diagnostics should be sorted deterministically by repoId'
);
assert.ok(
  diagnostics.some((entry) => entry.status === 'missing_index'),
  'missing indexes should be non-fatal diagnostics'
);

console.log('federated search multi-repo basic test passed');
