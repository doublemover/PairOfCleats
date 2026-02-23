#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTieredCompressionPolicy } from '../../../src/index/build/artifacts/compression-tier-policy.js';

const policy = buildTieredCompressionPolicy({
  artifactConfig: {
    compressionTiers: {
      enabled: true,
      hotNoCompression: true,
      coldForceCompression: true,
      hotArtifacts: ['chunk_meta'],
      coldArtifacts: ['repo_map']
    }
  },
  compressionOverrides: {
    dense_meta: {
      enabled: true,
      mode: 'gzip',
      keepRaw: false
    }
  },
  compressibleArtifacts: new Set(['chunk_meta', 'repo_map', 'dense_meta']),
  compressionEnabled: true,
  compressionMode: 'gzip',
  compressionKeepRaw: false
});

assert.equal(policy.resolveArtifactTier('chunk_meta'), 'hot', 'expected hot tier mapping for chunk_meta');
assert.equal(policy.resolveArtifactTier('repo_map'), 'cold', 'expected cold tier mapping for repo_map');
assert.equal(policy.resolveArtifactTier('unknown_surface'), 'warm', 'expected warm fallback tier for unlisted artifact');

assert.equal(
  policy.tieredCompressionOverrides.chunk_meta?.enabled,
  false,
  'expected hot tier artifact to be forced to uncompressed override'
);
assert.equal(
  policy.tieredCompressionOverrides.repo_map?.enabled,
  true,
  'expected cold tier artifact to be forced compressed when compression is enabled'
);
assert.equal(
  policy.tieredCompressionOverrides.dense_meta?.enabled,
  true,
  'expected explicit compression override to remain unchanged'
);

assert.equal(
  policy.resolveShardCompression('chunk_meta'),
  null,
  'expected shard compression to disable hot artifacts when tier policy requires raw writes'
);
assert.equal(
  policy.resolveShardCompression('repo_map'),
  'gzip',
  'expected shard compression to force cold artifact compression'
);
assert.equal(
  policy.resolveShardCompression('dense_meta'),
  'gzip',
  'expected explicit compression override to control shard compression result'
);

console.log('compression tier policy test passed');
