#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initBuildState,
  loadOrderingLedger,
  recordOrderingHash
} from '../../../src/index/build/build-state.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ordering-ledger-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'build-ledger-integration',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'hash',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

await recordOrderingHash(buildRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: 'sha1:1111',
  rule: 'chunk_meta:compareChunkMetaRows',
  count: 2
});

await recordOrderingHash(buildRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'file_relations',
  hash: 'sha1:2222',
  rule: 'file_relations:file',
  count: 3
});

const ledger = await loadOrderingLedger(buildRoot);
assert.ok(ledger, 'expected ordering ledger');
const stageKey = 'stage2:code';
assert.ok(ledger.stages?.[stageKey], 'expected stage entry');
assert.equal(ledger.stages[stageKey].artifacts.chunk_meta.hash, 'sha1:1111');
assert.equal(ledger.stages[stageKey].artifacts.file_relations.hash, 'sha1:2222');

console.log('ordering ledger integration tests passed');
