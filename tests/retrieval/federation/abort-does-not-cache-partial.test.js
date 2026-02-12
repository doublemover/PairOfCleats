#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-abort-cache-'));
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
const controller = new AbortController();
const searchFn = async (repoRootCanonical, params) => {
  searchCalls += 1;
  const leaf = path.basename(repoRootCanonical);
  if (leaf === 'repo-a') {
    // Simulate client disconnect after one successful repo result.
    controller.abort();
    return {
      backend: 'memory',
      code: [{ id: 'hit-a', file: 'src/a.js', start: 1, end: 1, score: 1 }],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
  if (params?.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
  }
  return {
    backend: 'memory',
    code: [{ id: 'hit-b', file: 'src/b.js', start: 1, end: 1, score: 1 }],
    prose: [],
    extractedProse: [],
    records: []
  };
};

await assert.rejects(
  runFederatedSearch({
    workspacePath,
    query: 'abort-cache',
    search: { mode: 'code', top: 5 },
    limits: { concurrency: 1 }
  }, {
    signal: controller.signal,
    searchFn
  }),
  (error) => {
    assert.equal(error?.code, ERROR_CODES.CANCELLED);
    return true;
  }
);

const successful = await runFederatedSearch({
  workspacePath,
  query: 'abort-cache',
  search: { mode: 'code', top: 5 },
  limits: { concurrency: 1 }
}, {
  searchFn
});

assert.equal(searchCalls, 4, 'second request should re-run fanout, not reuse aborted partial cache');
assert.equal(successful.code.length, 2, 'non-aborted retry should include both repos');

console.log('federated abort should not cache partial results test passed');
