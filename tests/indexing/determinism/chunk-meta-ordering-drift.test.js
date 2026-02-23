#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { initBuildState, recordOrderingHash } from '../../../src/index/build/build-state.js';
import { createOrderingHasher, stableOrderWithComparator } from '../../../src/shared/order.js';
import { compareChunkMetaRows } from '../../../src/index/build/artifacts/helpers.js';
import { createBaseIndex, defaultUserConfig } from '../validate/helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'chunk-meta-ordering-drift');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMeta = [
  { id: 1, file: 'b.js', start: 20, chunkId: 'b-1', chunkUid: 'ck:b', name: 'Beta' },
  { id: 0, file: 'a.js', start: 10, chunkId: 'a-1', chunkUid: 'ck:a', name: 'Alpha' }
];

const { repoRoot, indexRoot } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta
});

await initBuildState({
  buildRoot: indexRoot,
  buildId: 'build-ordering-drift',
  repoRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'hash',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

const ordered = stableOrderWithComparator(chunkMeta, compareChunkMetaRows);
const hasher = createOrderingHasher();
for (const row of ordered) {
  hasher.update(JSON.stringify(row));
}
const digest = hasher.digest();

await recordOrderingHash(indexRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: digest,
  rule: 'chunk_meta:compareChunkMetaRows',
  count: digest.count
});

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false,
  validateOrdering: true
});

assert.ok(!report.ok, 'expected ordering drift to fail strict validation');
assert.ok(report.issues.some((issue) => issue.includes('ordering ledger mismatch')));

console.log('chunk_meta ordering drift test passed');
