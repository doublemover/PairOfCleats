#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initBuildState,
  loadOrderingLedger,
  recordOrderingHash,
  recordOrderingSeedInputs
} from '../../../src/index/build/build-state.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-ledger-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'build-ledger',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage1',
  configHash: 'hash',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

await recordOrderingSeedInputs(buildRoot, {
  discoveryHash: 'discovery-hash',
  fileListHash: 'file-list-hash',
  fileCount: 3
}, { stage: 'stage1', mode: 'code' });

await recordOrderingHash(buildRoot, {
  stage: 'stage1',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: 'hash-1',
  rule: 'stable-order',
  count: 2
});

const ledger = await loadOrderingLedger(buildRoot);
assert.ok(ledger, 'expected ordering ledger to load');
assert.equal(ledger.seeds.discoveryHash, 'discovery-hash');
assert.equal(ledger.seeds.fileListHash, 'file-list-hash');
assert.equal(ledger.seeds.fileCount, 3);

const stageKey = 'stage1:code';
const stage = ledger.stages?.[stageKey];
assert.ok(stage, 'expected stage entry');
assert.equal(stage.seeds?.fileCount, 3);
assert.equal(stage.artifacts?.chunk_meta?.hash, 'hash-1');

console.log('ordering ledger roundtrip tests passed');
