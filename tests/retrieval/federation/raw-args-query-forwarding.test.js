#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-rawargs-query-'));
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

const searchCalls = [];
const queryToken = 'federated-query-token';
const rawArgs = [
  queryToken,
  '--workspace',
  workspacePath,
  '--mode',
  'code',
  '--top',
  '5'
];

await runFederatedSearch({
  workspacePath,
  query: queryToken,
  rawArgs
}, {
  searchFn: async (_repoRootCanonical, params) => {
    searchCalls.push(params);
    return {
      backend: 'memory',
      code: [],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.equal(searchCalls.length, 1, 'expected one federated repo search call');
const [call] = searchCalls;
assert.equal(String(call?.query || ''), '', 'rawArgs path must not append query separately');
const queryMentions = (Array.isArray(call?.args) ? call.args : [])
  .filter((token) => token === queryToken)
  .length;
assert.equal(queryMentions, 1, 'query token should appear exactly once in per-repo args');

console.log('federated raw args query forwarding test passed');
