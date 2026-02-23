#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ORDERING_LEDGER_SCHEMA_VERSION,
  initBuildState,
  loadOrderingLedger,
  recordOrderingHash,
  recordOrderingSeedInputs
} from '../../../src/index/build/build-state.js';
import { hashDeterministicLines } from '../../../src/shared/invariants.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-truth-ledger-hash-alignment');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'ledger-hash-alignment',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'cfg',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc123' },
  signatureVersion: 2
});

await recordOrderingSeedInputs(buildRoot, {
  discoveryHash: 'discovery-hash',
  fileListHash: 'filelist-hash',
  fileCount: 2
}, { stage: 'stage2', mode: 'code' });

const orderingLines = [
  '{"id":0,"file":"src/a.js"}',
  '{"id":1,"file":"src/b.js"}'
];
const ordering = hashDeterministicLines(orderingLines, { encodeLine: (line) => line });
assert.ok(ordering?.hash?.startsWith('sha1:'), 'ordering hash should use sha1-prefixed format');

await recordOrderingHash(buildRoot, {
  stage: 'stage2',
  mode: 'code',
  artifact: 'chunk_meta',
  hash: ordering.hash,
  rule: 'chunk_meta:compareChunkMetaRows',
  count: ordering.count
});

const ledger = await loadOrderingLedger(buildRoot);
assert.ok(ledger, 'expected ordering ledger');
assert.equal(ledger.schemaVersion, ORDERING_LEDGER_SCHEMA_VERSION);
assert.equal(ledger.seeds.discoveryHash, 'discovery-hash');
assert.equal(ledger.seeds.fileListHash, 'filelist-hash');
assert.equal(ledger.seeds.fileCount, 2);

const stageKey = 'stage2:code';
const stage = ledger.stages?.[stageKey];
assert.ok(stage, 'expected stage2:code entry');
assert.equal(stage.artifacts?.chunk_meta?.hash, ordering.hash);
assert.equal(stage.artifacts?.chunk_meta?.count, ordering.count);
assert.equal(stage.artifacts?.chunk_meta?.rule, 'chunk_meta:compareChunkMetaRows');

const specPath = path.join(root, 'docs', 'specs', 'build-truth-ledger.md');
const specText = await fs.readFile(specPath, 'utf8');
for (const expected of [
  'orderingLedger.schemaVersion',
  'orderingLedger.seeds',
  'orderingLedger.stages',
  'SHA-1',
  'JSON.stringify(row)'
]) {
  assert.ok(specText.includes(expected), `spec missing expected contract text: ${expected}`);
}

console.log('build truth ledger hash alignment test passed');
