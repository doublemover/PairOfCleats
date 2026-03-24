#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-generation-context-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(repoRoot);
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-ctx');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-ctx',
  buildRoot,
  buildRootsByMode: { code: buildRoot },
  modes: ['code']
}, null, 2), 'utf8');
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-code'
}, null, 2), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "alpha" }
  ]
}`, 'utf8');

let capturedGenerationContext = null;
const response = await runFederatedSearch({
  workspacePath,
  query: 'generation-context-forwarding',
  search: { mode: 'code', top: 5 }
}, {
  resolveRepoCaches: async () => ({
    indexCache: { get: () => null, set: () => {}, delete: () => {}, clear: () => {}, size: () => 0, cache: null },
    sqliteCache: null,
    buildId: 'build-ctx',
    buildRoot,
    activeBuildRoot: buildRoot,
    buildGenerationKey: 'test-generation-key'
  }),
  searchFn: async (_repoRootCanonical, params) => {
    capturedGenerationContext = params.generationContext || null;
    return {
      backend: 'memory',
      code: [{ id: 'hit', file: 'src/file.js', start: 1, end: 1, score: 1 }],
      prose: [],
      extractedProse: [],
      records: []
    };
  }
});

assert.equal(capturedGenerationContext?.buildId, 'build-ctx');
assert.equal(capturedGenerationContext?.activeBuildRoot, buildRoot);
assert.equal(capturedGenerationContext?.buildGenerationKey, 'test-generation-key');
assert.equal(response.repos[0]?.freshness?.buildId, 'build-ctx');
assert.ok(response.repos[0]?.freshness?.generationKey, 'expected freshness generation key in response');

console.log('federated repo generation context forwarding test passed');
