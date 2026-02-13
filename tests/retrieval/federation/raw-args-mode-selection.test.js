#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFederatedCliRequest } from '../../../src/retrieval/federation/args.js';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-rawargs-mode-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');
const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'test-build');
const recordsIndexDir = path.join(buildRoot, 'index-records');
await fs.mkdir(recordsIndexDir, { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'test-build',
  buildRoot,
  modes: ['records']
}, null, 2), 'utf8');
await fs.writeFile(path.join(recordsIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(recordsIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(recordsIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-records'
}, null, 2), 'utf8');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const queryToken = 'federated-mode-records-token';
const rawArgs = [
  queryToken,
  '--workspace',
  workspacePath,
  '--mode',
  'records',
  '--top',
  '5'
];

const request = parseFederatedCliRequest(rawArgs);
const searchCalls = [];

const response = await runFederatedSearch(request, {
  searchFn: async (_repoRootCanonical, params) => {
    searchCalls.push(params);
    return {
      backend: 'memory',
      code: [
        {
          id: 'code-1',
          file: 'src/code.js',
          start: 1,
          end: 1,
          score: 1
        }
      ],
      prose: [],
      extractedProse: [],
      records: [
        {
          id: 'record-1',
          file: 'records/input.json',
          start: 1,
          end: 1,
          score: 1
        }
      ]
    };
  }
});

assert.equal(searchCalls.length, 1, 'expected one federated repo search call');
const [call] = searchCalls;
assert.equal(String(call?.query || ''), '', 'rawArgs path must not append query separately');
assert.ok(
  Array.isArray(call?.args) && call.args.includes('records'),
  'per-repo args should keep --mode records'
);
assert.equal(response.records.length, 1, 'records mode should merge records hits');
assert.equal(response.code.length, 0, 'records mode should not merge code hits');
assert.equal(response.prose.length, 0, 'records mode should not merge prose hits');
assert.equal(response.extractedProse.length, 0, 'records mode should not merge extracted-prose hits');

console.log('federated raw args mode selection test passed');
