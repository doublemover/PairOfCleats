#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildCacheIndexFileMap,
  mergeCacheIndex,
  normalizeCacheIndex,
  resolveNextShardIdFromShards
} from '../../../tools/build/embeddings/cache/index-state.js';

const toIso = (value) => new Date(value).toISOString();

const canonicalMap = buildCacheIndexFileMap({
  'key-old': {
    file: 'src/dup.js',
    lastAccessAt: toIso('2024-01-01T00:00:00Z'),
    hits: 10,
    createdAt: toIso('2024-01-01T00:00:00Z')
  },
  'key-new': {
    file: 'src/dup.js',
    lastAccessAt: toIso('2025-01-01T00:00:00Z'),
    hits: 1,
    createdAt: toIso('2025-01-01T00:00:00Z')
  },
  'key-side': {
    file: 'src/side.js',
    lastAccessAt: toIso('2025-02-01T00:00:00Z'),
    hits: 1,
    createdAt: toIso('2025-02-01T00:00:00Z')
  }
});
assert.equal(canonicalMap['src/dup.js'], 'key-new', 'expected newer lastAccess entry to win duplicate file mapping');
assert.equal(canonicalMap['src/side.js'], 'key-side', 'expected non-duplicate file mapping to be preserved');

const normalized = normalizeCacheIndex({
  version: 1,
  identityKey: 'id',
  createdAt: toIso('2025-01-01T00:00:00Z'),
  updatedAt: toIso('2025-01-01T00:00:00Z'),
  nextShardId: 0,
  currentShard: null,
  entries: {
    a: {
      key: 'a',
      file: 'src/a.js',
      lastAccessAt: toIso('2025-01-01T00:00:00Z'),
      createdAt: toIso('2025-01-01T00:00:00Z')
    }
  },
  files: {
    'src/stale.js': 'stale-key',
    'src/a.js': 'wrong-key'
  },
  shards: {}
}, 'id');
assert.deepEqual(
  normalized.files,
  { 'src/a.js': 'a' },
  'expected normalizeCacheIndex to rebuild files map from canonical entries only'
);
assert.equal(
  normalizeCacheIndex({
    version: 1,
    identityKey: 'id',
    createdAt: toIso('2025-01-01T00:00:00Z'),
    updatedAt: toIso('2025-01-01T00:00:00Z'),
    nextShardId: 0,
    currentShard: null,
    entries: {},
    files: {},
    shards: {
      'shard-00007.bin': { createdAt: toIso('2025-01-01T00:00:00Z'), sizeBytes: 1 }
    }
  }, 'id').nextShardId,
  8,
  'expected normalizeCacheIndex to derive nextShardId from highest shard suffix when configured nextShardId is stale'
);
assert.equal(
  resolveNextShardIdFromShards({
    'shard-00001.bin': { sizeBytes: 1 },
    'shard-00009.bin': { sizeBytes: 1 },
    'custom.bin': { sizeBytes: 1 }
  }),
  10,
  'expected next shard id derivation to ignore unknown names and use highest numeric shard suffix'
);

const base = {
  version: 1,
  identityKey: 'id',
  createdAt: toIso('2025-01-01T00:00:00Z'),
  updatedAt: toIso('2025-01-01T00:00:00Z'),
  nextShardId: 0,
  currentShard: null,
  entries: {
    alpha: {
      key: 'alpha',
      file: 'src/merge.js',
      lastAccessAt: toIso('2025-01-01T00:00:00Z'),
      createdAt: toIso('2025-01-01T00:00:00Z')
    }
  },
  files: {
    'src/merge.js': 'alpha',
    'src/ghost.js': 'ghost'
  },
  shards: {
    'shard-00002.bin': { createdAt: toIso('2025-01-01T00:00:00Z'), sizeBytes: 1024 }
  }
};
const incoming = {
  nextShardId: 3,
  entries: {
    beta: {
      key: 'beta',
      file: 'src/merge.js',
      lastAccessAt: toIso('2026-01-01T00:00:00Z'),
      createdAt: toIso('2026-01-01T00:00:00Z')
    }
  },
  files: {
    'src/ghost.js': 'ghost'
  },
  shards: {
    'shard-00010.bin': { createdAt: toIso('2026-01-01T00:00:00Z'), sizeBytes: 1024 }
  }
};

mergeCacheIndex(base, incoming);
assert.equal(base.files['src/merge.js'], 'beta', 'expected merge to rebuild file map using latest entry ownership');
assert.equal(base.files['src/ghost.js'], undefined, 'expected merge to drop stale file lookups');
assert.equal(
  base.nextShardId,
  11,
  'expected merge to lift nextShardId to avoid colliding with existing shard names'
);

console.log('embeddings cache index file-map canonicalization test passed');
