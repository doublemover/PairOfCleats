#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-redact-fields-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
const codeIndexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.mkdir(codeIndexDir, { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'test-build',
  buildRoot,
  modes: ['code']
}, null, 2), 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-test'
}, null, 2), 'utf8');

const literalSnippet = 'C:\\snippet\\literal text should survive redaction';
const absoluteFilePath = path.join(repoRoot, 'src', 'app.js');
let searchCalls = 0;

const request = {
  workspacePath,
  query: 'redaction-scope',
  select: [repoRoot],
  search: {
    mode: 'code',
    top: 5
  }
};

const searchFn = async () => {
  searchCalls += 1;
  return {
    backend: 'memory',
    code: [
      {
        id: 'hit-1',
        file: absoluteFilePath,
        snippet: literalSnippet,
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

const first = await runFederatedSearch(request, { searchFn });
const second = await runFederatedSearch(request, { searchFn });

assert.equal(searchCalls, 1, 'second request should reuse federated cache');
assert.equal(first.code[0]?.file, '<redacted>', 'absolute file path field should be redacted');
assert.equal(first.code[0]?.snippet, literalSnippet, 'non-path snippet content should not be redacted');
assert.equal(first.meta?.selection?.explicitSelects?.[0], '<redacted>', 'absolute explicit select path should be redacted');
assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.rootAbs, '<redacted>', 'cohort rootAbs should be redacted');
assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.repoRootResolved, '<redacted>', 'cohort repoRootResolved should be redacted');
assert.equal(first.meta?.cohorts?.selectedReposByMode?.code?.[0]?.indexes?.code?.indexDir, '<redacted>', 'cohort indexDir should be redacted');
assert.equal(second.code[0]?.file, '<redacted>', 'cached file field should remain redacted');
assert.equal(second.code[0]?.snippet, literalSnippet, 'cached snippet should preserve original content');
assert.equal(second.meta?.selection?.explicitSelects?.[0], '<redacted>', 'cached explicit select path should remain redacted');
assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.rootAbs, '<redacted>', 'cached cohort rootAbs should remain redacted');
assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.repoRootResolved, '<redacted>', 'cached cohort repoRootResolved should remain redacted');
assert.equal(second.meta?.cohorts?.selectedReposByMode?.code?.[0]?.indexes?.code?.indexDir, '<redacted>', 'cached cohort indexDir should remain redacted');

console.log('federation path redaction field scope test passed');
