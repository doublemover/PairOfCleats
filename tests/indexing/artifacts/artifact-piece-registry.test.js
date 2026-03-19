#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';

const outDir = path.join(process.cwd(), 'tmp-piece-registry');
const registry = createArtifactPieceRegistry({
  outDir,
  resolveArtifactTier: (artifactName) => (
    artifactName.includes('metrics') ? 'hot' : (artifactName.includes('archive') ? 'cold' : 'warm')
  )
});

const metricsPath = path.join(outDir, 'metrics.json');
const archivePath = path.join(outDir, 'archive.json');

registry.addPieceFile({ type: 'stats', name: 'metrics', format: 'json' }, metricsPath);
registry.addPieceFile({ type: 'stats', name: 'archive', format: 'json' }, archivePath);
registry.updatePieceMetadata('metrics.json', {
  bytes: 42,
  checksumAlgo: 'sha1',
  checksum: 'abc123'
});

const entries = registry.listPieceEntries().sort((a, b) => a.path.localeCompare(b.path));
assert.equal(entries.length, 2, 'expected both committed pieces to be tracked');
assert.equal(entries[1].path, 'metrics.json', 'expected normalized relative manifest path');
assert.equal(entries[1].tier, 'hot', 'expected hot tier from artifact policy');
assert.equal(entries[1].layout.group, 'mmap-hot', 'expected hot tier layout group');
assert.equal(entries[1].layout.contiguous, true, 'expected hot tier to be contiguous');
assert.equal(entries[1].bytes, 42, 'expected piece metadata bytes to be attached');
assert.equal(entries[1].checksum, 'sha1:abc123', 'expected checksum metadata to be attached');
assert.equal(entries[0].tier, 'cold', 'expected cold tier from artifact policy');

assert.equal(registry.hasPieceFile(metricsPath), true, 'expected tracked piece lookup by full path');
registry.removePieceFile(metricsPath);
assert.equal(registry.hasPieceFile(metricsPath), false, 'expected removed piece to no longer be tracked');

console.log('artifact piece registry test passed');
