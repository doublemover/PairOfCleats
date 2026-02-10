#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { initBuildState, recordOrderingHash } from '../../../src/index/build/build-state.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'ledger-validation');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot });

await initBuildState({
  buildRoot: indexRoot,
  buildId: 'build-ledger-validate',
  repoRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'hash',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

await recordOrderingHash(indexRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: 'sha1:deadbeef',
  rule: 'chunk_meta:compareChunkMetaRows',
  count: 1
});

const warnReport = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(warnReport.ok, 'expected ordering drift to be a warning by default');
assert.ok(warnReport.warnings.some((warning) => warning.includes('ordering ledger mismatch')));

const strictReport = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false,
  validateOrdering: true
});

assert.ok(!strictReport.ok, 'expected ordering drift to fail when validateOrdering is true');
assert.ok(strictReport.issues.some((issue) => issue.includes('ordering ledger mismatch')));

console.log('ordering ledger validation tests passed');
