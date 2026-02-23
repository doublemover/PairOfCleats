#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createArtifactCompressionTierResolver,
  resolveArtifactCompressionTier
} from '../../../src/shared/artifact-io/compression.js';

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
const cachedResolver = createArtifactCompressionTierResolver({
  hotArtifacts: ['custom_payload'],
  coldArtifacts: ['repo_map'],
  defaultTier: 'warm'
});
assert.equal(
  cachedResolver('custom_payload'),
  'hot',
  'expected cached resolver hot-tier mapping to match one-shot resolver behavior'
);
assert.equal(
  cachedResolver('repo_map'),
  'cold',
  'expected cached resolver cold-tier mapping to be applied'
);
assert.equal(
  cachedResolver('unknown_payload'),
  'warm',
  'expected cached resolver to honor default warm tier'
);

console.log('compression tier resolution test passed');
