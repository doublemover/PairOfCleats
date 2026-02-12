#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-propagate-fail-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoMissing = path.join(tempRoot, 'repo-missing');
const repoBroken = path.join(tempRoot, 'repo-broken');
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

await writeRepo(repoMissing);
await writeRepo(repoBroken);

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-missing", "alias": "missing", "priority": 10 },
    { "root": "./repo-broken", "alias": "broken", "priority": 5 }
  ]
}`, 'utf8');

let searchCalls = 0;
const searchFn = async (repoRootCanonical) => {
  searchCalls += 1;
  const leaf = path.basename(repoRootCanonical);
  if (leaf === 'repo-missing') {
    throw createError(ERROR_CODES.NO_INDEX, 'Index not found');
  }
  throw createError(ERROR_CODES.INTERNAL, 'Backend unavailable');
};

await assert.rejects(
  runFederatedSearch({
    workspacePath,
    query: 'federated',
    search: { mode: 'code', top: 5 },
    limits: { perRepoTop: 5, concurrency: 2 }
  }, { searchFn }),
  (error) => {
    assert.equal(error?.code, ERROR_CODES.INTERNAL);
    assert.match(String(error?.message || ''), /backend unavailable/i);
    return true;
  }
);
assert.equal(searchCalls, 2, 'expected all selected repos to be attempted before failing');

console.log('federated non-strict failure propagation test passed');
