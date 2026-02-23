#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initBuildState, recordOrderingHash } from '../../../src/index/build/build-state.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { hashDeterministicLines } from '../../../src/shared/invariants.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'determinism-line-hash');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const inputChunkMeta = [
  {
    zField: 'z',
    aField: 'a',
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 1
  }
];

const { repoRoot, indexRoot } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta: inputChunkMeta,
  indexState: {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    stage: 'stage2',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
  }
});

await initBuildState({
  buildRoot: indexRoot,
  buildId: 'determinism-line-hash',
  repoRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'cfg',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

const chunkMetaPath = path.join(indexRoot, 'index-code', 'chunk_meta.json');
const chunkMetaRows = JSON.parse(await fs.readFile(chunkMetaPath, 'utf8'));
const emittedLineHash = hashDeterministicLines(
  chunkMetaRows.map((row) => JSON.stringify(row)),
  { encodeLine: (line) => line }
);

await recordOrderingHash(indexRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: emittedLineHash.hash,
  rule: 'chunk_meta:compareChunkMetaRows',
  count: emittedLineHash.count
});

const passReport = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false,
  validateOrdering: true
});
assert.ok(passReport.ok, 'line-based ordering hash should validate');

const sortedLineHash = hashDeterministicLines(
  chunkMetaRows.map((row) => {
    const sorted = {};
    for (const key of Object.keys(row).sort()) {
      sorted[key] = row[key];
    }
    return JSON.stringify(sorted);
  }),
  { encodeLine: (line) => line }
);
assert.notEqual(sortedLineHash.hash, emittedLineHash.hash, 'sorted-key hash should differ from emitted-line hash');

await recordOrderingHash(indexRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: sortedLineHash.hash,
  rule: 'chunk_meta:compareChunkMetaRows',
  count: sortedLineHash.count
});

const failReport = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false,
  validateOrdering: true
});
assert.equal(failReport.ok, false, 'non-emitted ordering hash should fail strict ordering validation');
assert.ok(
  failReport.issues.some((issue) => issue.includes('ordering ledger mismatch for chunk_meta')),
  'expected chunk_meta ordering mismatch issue'
);

console.log('determinism line hash test passed');
