#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-strict-cache-key-'));
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
    { "root": "./repo-b", "alias": "b", "priority": 1 }
  ]
}`, 'utf8');

let searchCalls = 0;
const searchFn = async (repoRootCanonical) => {
  searchCalls += 1;
  if (path.basename(repoRootCanonical) === 'repo-a') {
    throw createError(ERROR_CODES.NO_INDEX, 'missing index for strict cache-key test');
  }
  return {
    backend: 'memory',
    code: [{ id: 'hit-b', file: 'src/b.js', start: 1, end: 1, score: 1 }],
    prose: [],
    extractedProse: [],
    records: []
  };
};

const baseRequest = {
  workspacePath,
  query: 'strict-cache-key-separation',
  search: { mode: 'code', top: 5 },
  limits: { concurrency: 1 }
};

const nonStrict = await runFederatedSearch(baseRequest, { searchFn });
assert.equal(nonStrict.ok, true);
assert.equal(nonStrict.code.length, 1, 'non-strict request should return partial success');

await assert.rejects(
  runFederatedSearch({ ...baseRequest, strict: true }, { searchFn }),
  (error) => error?.code === ERROR_CODES.NO_INDEX
);

assert.ok(
  searchCalls >= 3,
  `strict request should not reuse non-strict cache entry (observed searchCalls=${searchCalls})`
);

console.log('federation strict cache-key separation test passed');
