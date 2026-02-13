#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-cli-top-zero-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');
const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
const codeIndexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(codeIndexDir, { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'test-build',
  buildRoot,
  modes: ['code']
}, null, 2), 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(codeIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-code'
}, null, 2), 'utf8');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const request = parseFederatedCliRequest([
  '--workspace',
  workspacePath,
  '--mode',
  'code',
  '--top',
  '0',
  'needle'
]);

assert.equal(request.top, 0, 'federated CLI parser must preserve explicit --top 0');
assert.equal(request.perRepoTop, 0, 'per-repo top fallback should also preserve zero');

const searchCalls = [];
const response = await runFederatedSearch(request, {
  searchFn: async (_repoRootCanonical, params) => {
    searchCalls.push(params);
    return {
      backend: 'memory',
      code: [
        { id: 'hit-1', file: 'src/a.js', start: 1, end: 1, score: 1 },
        { id: 'hit-2', file: 'src/b.js', start: 1, end: 1, score: 1 }
      ],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.equal(searchCalls.length, 1, 'expected one federated repo search call');
const args = Array.isArray(searchCalls[0]?.args) ? searchCalls[0].args : [];
const topFlagIndex = args.findIndex((token) => token === '--top');
assert.notEqual(topFlagIndex, -1, 'per-repo args should include --top');
assert.equal(args[topFlagIndex + 1], '0', 'per-repo args should preserve top zero');
assert.equal(response.code.length, 0, 'merged response should honor top zero');

console.log('federated cli top zero preservation test passed');
