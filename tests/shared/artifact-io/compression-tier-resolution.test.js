#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveArtifactCompressionTier } from '../../../src/shared/artifact-io/compression.js';

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

console.log('compression tier resolution test passed');
