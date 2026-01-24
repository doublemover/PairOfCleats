#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStatus } from '../src/integrations/core/status.js';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../src/contracts/versioning.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'report-artifacts-manifest');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const repoRoot = path.join(cacheRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const prevCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
await fs.mkdir(codeDir, { recursive: true });
await fs.writeFile(
  path.join(codeDir, 'chunk_meta.json'),
  JSON.stringify([{ id: 0, file: 'alpha.js', start: 0, end: 1 }])
);
await fs.writeFile(
  path.join(codeDir, 'token_postings.json'),
  JSON.stringify({
    fields: { avgDocLen: 1, totalDocs: 1 },
    arrays: { vocab: ['alpha'], postings: [[[0, 1]]], docLengths: [1] }
  })
);
await fs.mkdir(path.join(codeDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(codeDir, 'pieces', 'manifest.json'),
  JSON.stringify({
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [
      { name: 'token_postings', path: 'token_postings.json', format: 'json' }
    ]
  }, null, 2)
);

const status = await getStatus({ repoRoot });
const issues = status?.health?.issues || [];
assert.ok(
  issues.includes('index-code chunk_meta missing in manifest'),
  `expected chunk_meta manifest issue, got: ${issues.join(', ')}`
);

console.log('report-artifacts manifest-driven test passed');

if (prevCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = prevCacheRoot;
}
