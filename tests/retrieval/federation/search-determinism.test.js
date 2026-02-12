#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-determinism-'));
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
    { "root": "./repo-a", "alias": "alpha", "priority": 5 },
    { "root": "./repo-b", "alias": "beta", "priority": 5 }
  ]
}`, 'utf8');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const searchFn = async (repoRootCanonical) => {
  if (path.basename(repoRootCanonical) === 'repo-b') {
    await wait(20);
  }
  return {
    backend: 'memory',
    code: [
      {
        id: 'shared-id',
        file: 'src/shared.js',
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

const request = {
  workspacePath,
  query: 'deterministic',
  search: { mode: 'code', top: 2 },
  limits: { perRepoTop: 2, concurrency: 2 }
};

const first = await runFederatedSearch(request, { searchFn });
const second = await runFederatedSearch(request, { searchFn });

assert.equal(
  stableStringify(first),
  stableStringify(second),
  'federated response JSON must be deterministic across repeated runs'
);

console.log('federated search determinism test passed');
