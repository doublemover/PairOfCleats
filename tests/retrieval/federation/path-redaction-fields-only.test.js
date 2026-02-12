#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';

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

const literalSnippet = 'C:\\snippet\\literal text should survive redaction';
const absoluteFilePath = path.join(repoRoot, 'src', 'app.js');
let searchCalls = 0;

const request = {
  workspacePath,
  query: 'redaction-scope',
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
assert.equal(second.code[0]?.file, '<redacted>', 'cached file field should remain redacted');
assert.equal(second.code[0]?.snippet, literalSnippet, 'cached snippet should preserve original content');

console.log('federation path redaction field scope test passed');
