#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-response-completeness-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoComplete = path.join(tempRoot, 'repo-complete');
const repoFail = path.join(tempRoot, 'repo-fail');
const repoSkipped = path.join(tempRoot, 'repo-skipped');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

const writeRepo = async (repoRoot, modes) => {
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

await writeRepo(repoComplete, ['code']);
await writeRepo(repoFail, ['code']);
await writeRepo(repoSkipped, ['prose']);

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-complete", "alias": "complete", "priority": 10 },
    { "root": "./repo-fail", "alias": "fail", "priority": 5 },
    { "root": "./repo-skipped", "alias": "skipped", "priority": 1 }
  ]
}`, 'utf8');

const searchCalls = [];
const response = await runFederatedSearch({
  workspacePath,
  query: 'response-completeness',
  search: { mode: 'code', top: 5 },
  limits: { concurrency: 1 }
}, {
  searchFn: async (repoRootCanonical) => {
    const leaf = path.basename(repoRootCanonical);
    searchCalls.push(leaf);
    if (leaf === 'repo-fail') {
      throw createError(ERROR_CODES.NO_INDEX, 'simulated missing code index');
    }
    return {
      backend: 'memory',
      code: [{ id: `hit-${leaf}`, file: `src/${leaf}.js`, start: 1, end: 1, score: 1 }],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.equal(response.ok, true);
assert.equal(response.status, 'partial');
assert.deepEqual(response.meta?.completeness?.repoCounts, {
  complete: 1,
  partial: 1,
  degraded: 1,
  empty: 0
});
assert.deepEqual(
  searchCalls.slice().sort(),
  ['repo-complete', 'repo-fail'],
  'repo with no eligible requested modes should be reported, not executed'
);

const completeRepo = response.repos.find((entry) => entry.repoId?.includes('repo-complete'));
assert.equal(completeRepo?.status, 'ok');
assert.equal(completeRepo?.completeness, 'complete');
assert.equal(completeRepo?.freshness?.buildId, 'test-build');
assert.equal(completeRepo?.modes?.fulfilled?.includes('code'), true);

const failedRepo = response.repos.find((entry) => entry.repoId?.includes('repo-fail'));
assert.equal(failedRepo?.status, 'missing_index');
assert.equal(failedRepo?.completeness, 'partial');
assert.equal(failedRepo?.modes?.executionFailures?.length, 1);

const skippedRepo = response.repos.find((entry) => entry.repoId?.includes('repo-skipped'));
assert.equal(skippedRepo?.status, 'skipped');
assert.equal(skippedRepo?.completeness, 'degraded');
assert.equal(skippedRepo?.modes?.eligible?.length, 0);
assert.equal(skippedRepo?.modes?.unavailable?.[0]?.mode, 'code');

console.log('federated response completeness contract test passed');
