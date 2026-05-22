#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  collectCompressedCandidates,
  collectCompressedJsonlCandidates,
  resolveArtifactCompressionTier
} from '../../../src/shared/artifact-io/compression.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

assert.equal(
  resolveArtifactCompressionTier('chunk_meta'),
  'hot',
  'expected chunk_meta to map to hot tier'
);
assert.equal(
  resolveArtifactCompressionTier('repo_map'),
  'cold',
  'expected repo_map to map to cold tier'
);
assert.equal(
  resolveArtifactCompressionTier('minhash_signatures'),
  'warm',
  'expected unspecified artifacts to map to warm tier'
);
assert.equal(
  resolveArtifactCompressionTier('pieces/chunk_meta.json.zst'),
  'hot',
  'expected compressed path normalization to preserve hot tier mapping'
);
assert.equal(
  resolveArtifactCompressionTier('custom_payload', {
    hotArtifacts: ['custom_payload'],
    coldArtifacts: [],
    defaultTier: 'warm'
  }),
  'hot',
  'expected custom hot tier override to be honored'
);

const tempRoot = resolveTestCachePath(process.cwd(), 'compression-tier-resolution');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const basePath = path.join(tempRoot, 'artifact.json');
const candidatePaths = [
  [`${basePath}.zst`, new Date('2026-05-20T00:00:03.000Z')],
  [`${basePath}.zst.bak`, new Date('2026-05-20T00:00:04.000Z')],
  [`${basePath}.gz`, new Date('2026-05-20T00:00:02.000Z')],
  [`${basePath}.gz.bak`, new Date('2026-05-20T00:00:01.000Z')]
];
for (const [candidatePath, mtime] of candidatePaths) {
  await fsPromises.writeFile(candidatePath, candidatePath, 'utf8');
  await fsPromises.utimes(candidatePath, mtime, mtime);
}

const expectedCompressedCandidates = [
  { path: `${basePath}.zst`, compression: 'zstd', cleanup: true },
  { path: `${basePath}.gz`, compression: 'gzip', cleanup: true },
  { path: `${basePath}.zst.bak`, compression: 'zstd', cleanup: false },
  { path: `${basePath}.gz.bak`, compression: 'gzip', cleanup: false }
];
const normalizeCandidate = ({ path: candidatePath, compression, cleanup }) => ({
  path: candidatePath,
  compression,
  cleanup
});
assert.deepEqual(
  collectCompressedCandidates(basePath).map(normalizeCandidate),
  expectedCompressedCandidates,
  'expected compressed JSON candidate ordering to prefer live candidates, then newest backups'
);
assert.deepEqual(
  collectCompressedJsonlCandidates(basePath).map(normalizeCandidate),
  expectedCompressedCandidates,
  'expected compressed JSONL candidate ordering to match JSON candidate semantics'
);

console.log('compression tier resolution test passed');
