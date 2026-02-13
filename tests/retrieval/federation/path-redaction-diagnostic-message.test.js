#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-redact-diagnostic-message-'));
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

const leakedPath = path.join(repoB, 'index-code', 'pieces', 'manifest.json');
const searchFn = async (repoRootCanonical) => {
  const repoName = path.basename(repoRootCanonical);
  if (repoName === 'repo-b') {
    throw createError(ERROR_CODES.NO_INDEX, `Missing pieces manifest: ${leakedPath}`);
  }
  return {
    backend: 'memory',
    code: [{ id: 'hit-a', file: 'src/a.js', start: 1, end: 1, score: 1 }],
    prose: [],
    extractedProse: [],
    records: []
  };
};

const response = await runFederatedSearch({
  workspacePath,
  query: 'diagnostic-redaction',
  search: { mode: 'code', top: 5 }
}, { searchFn });

assert.equal(response.ok, true);
assert.equal(response.code.length, 1, 'successful repo should still return hits');
const missingRepo = (response.repos || []).find((entry) => entry.repoId && entry.status === 'missing_index');
assert.ok(missingRepo, 'missing-index repo diagnostic should be present');
const message = String(missingRepo?.error?.message || '');
assert.ok(message.includes('Missing pieces manifest:'), 'diagnostic context should remain readable');
assert.ok(message.includes('<redacted>'), 'diagnostic should redact embedded absolute paths');
assert.equal(message.includes(leakedPath), false, 'diagnostic should not leak absolute path');

console.log('federated diagnostic message path redaction test passed');
