#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  createPieceManifestRegistry,
  resolvePieceTier
} from '../../../src/index/build/artifacts/piece-manifest-registry.js';

applyTestEnv({ testing: '1' });

const fallbackTierCalls = [];
const fallbackTier = (name) => {
  fallbackTierCalls.push(name);
  return String(name).includes('cold') ? 'cold' : 'warm';
};

assert.equal(
  resolvePieceTier({
    entry: { tier: ' HOT ' },
    normalizedPath: 'pieces/hot.json',
    resolveArtifactTier: fallbackTier
  }),
  'hot',
  'expected explicit tier metadata to override policy fallback'
);

assert.equal(
  resolvePieceTier({
    entry: { name: 'cold-piece' },
    normalizedPath: 'pieces/cold.json',
    resolveArtifactTier: fallbackTier
  }),
  'cold',
  'expected policy fallback to evaluate entry name when explicit tier is missing'
);
assert.deepEqual(
  fallbackTierCalls,
  ['cold-piece'],
  'expected resolvePieceTier to call fallback resolver only for non-explicit tiers'
);

const outDir = path.resolve('tmp-piece-manifest-root');
const registry = createPieceManifestRegistry({
  outDir,
  resolveArtifactTier: (name) => (String(name).includes('hot') ? 'hot' : 'cold')
});

const sharedPath = path.join(outDir, 'pieces', 'hot-output.json');
registry.addPieceFile({ type: 'chunks', name: 'hot-output', format: 'json' }, sharedPath);
registry.addPieceFile({ type: 'chunks', name: 'hot-output-compressed', format: 'json', pathHint: 'ignored' }, sharedPath);

registry.addPieceFile(
  {
    type: 'postings',
    name: 'cold-output',
    format: 'json',
    tier: 'cold',
    layout: { group: 'archive' }
  },
  path.join(outDir, 'pieces', 'cold-output.json')
);

const normalizedShared = registry.formatArtifactLabel(sharedPath);
assert.equal(normalizedShared, 'pieces/hot-output.json', 'expected labels to be output-root relative and posix-normalized');

const [hotPrimary, hotDuplicate, coldEntry] = registry.pieceEntries;
assert.equal(hotPrimary.tier, 'hot');
assert.equal(hotPrimary.layout.group, 'mmap-hot');
assert.equal(hotPrimary.layout.contiguous, true);
assert.equal(hotPrimary.layout.order, 0, 'expected first hot artifact to get deterministic mmap order');
assert.equal(hotDuplicate.layout.order, 1, 'expected subsequent hot artifact registration to increment order');
assert.equal(coldEntry.tier, 'cold');
assert.equal(coldEntry.layout.group, 'archive', 'expected explicit layout group to remain unchanged');
assert.equal(coldEntry.layout.contiguous, false, 'expected non-hot entries to default contiguous=false');

registry.updatePieceMetadata(normalizedShared, {
  bytes: 4321,
  checksumAlgo: 'SHA256',
  checksum: 'ABCDEF'
});
assert.equal(hotPrimary.bytes, 4321);
assert.equal(hotDuplicate.bytes, 4321);
assert.equal(hotPrimary.checksum, 'sha256:abcdef');
assert.equal(hotDuplicate.checksum, 'sha256:abcdef');

registry.updatePieceMetadata('pieces/cold-output.json', {
  checksumHash: 'SHA1:001122'
});
assert.equal(coldEntry.checksum, 'sha1:001122', 'expected checksumHash fallback to normalize casing');

console.log('piece manifest registry test passed');
