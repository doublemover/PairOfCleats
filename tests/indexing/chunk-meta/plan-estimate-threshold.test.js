#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveChunkMetaPlan } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const buildIterator = ({ count, payloadSize }) => {
  const payload = 'x'.repeat(payloadSize);
  return (start, end) => (function* iter() {
    for (let i = start; i < end; i += 1) {
      yield {
        id: i,
        chunkId: `chunk-${i}`,
        chunkUid: `uid-${i}`,
        file: 'src/file.js',
        payload
      };
    }
  })();
};

const largeCount = 1200;
const largePlan = resolveChunkMetaPlan({
  chunks: Array.from({ length: largeCount }, (_, i) => ({ id: i })),
  chunkMetaIterator: buildIterator({ count: largeCount, payloadSize: 40_000 }),
  artifactMode: 'auto',
  chunkMetaFormatConfig: null,
  chunkMetaStreaming: false,
  chunkMetaBinaryColumnar: false,
  chunkMetaJsonlThreshold: 200000,
  chunkMetaShardSize: 100000,
  chunkMetaJsonlEstimateThresholdBytes: 8 * 1024 * 1024,
  maxJsonBytes: 128 * 1024 * 1024
});

assert.equal(largePlan.chunkMetaUseJsonl, true, 'expected large estimated chunk_meta payload to force JSONL mode');
assert.equal(largePlan.chunkMetaUseShards, false, 'expected JSONL mode without sharding when row count stays below shard size');

const smallCount = 800;
const smallPlan = resolveChunkMetaPlan({
  chunks: Array.from({ length: smallCount }, (_, i) => ({ id: i })),
  chunkMetaIterator: buildIterator({ count: smallCount, payloadSize: 128 }),
  artifactMode: 'auto',
  chunkMetaFormatConfig: null,
  chunkMetaStreaming: false,
  chunkMetaBinaryColumnar: false,
  chunkMetaJsonlThreshold: 200000,
  chunkMetaShardSize: 100000,
  chunkMetaJsonlEstimateThresholdBytes: 8 * 1024 * 1024,
  maxJsonBytes: 128 * 1024 * 1024
});

assert.equal(smallPlan.chunkMetaUseJsonl, false, 'expected small estimated payload to keep default JSON mode');

const defaultThresholdCount = 6000;
const defaultThresholdPlan = resolveChunkMetaPlan({
  chunks: Array.from({ length: defaultThresholdCount }, (_, i) => ({ id: i })),
  chunkMetaIterator: buildIterator({ count: defaultThresholdCount, payloadSize: 128 }),
  artifactMode: 'auto',
  chunkMetaFormatConfig: null,
  chunkMetaStreaming: false,
  chunkMetaBinaryColumnar: false,
  chunkMetaJsonlThreshold: 200000,
  chunkMetaShardSize: 100000,
  maxJsonBytes: 128 * 1024 * 1024
});

assert.equal(
  defaultThresholdPlan.chunkMetaUseJsonl,
  true,
  'expected default estimate threshold to force JSONL for ~1MB+ payloads'
);

const oversizedBinaryPlan = resolveChunkMetaPlan({
  chunks: Array.from({ length: largeCount, }, (_, i) => ({ id: i })),
  chunkMetaIterator: buildIterator({ count: largeCount, payloadSize: 600_000 }),
  artifactMode: 'auto',
  chunkMetaFormatConfig: null,
  chunkMetaStreaming: true,
  chunkMetaBinaryColumnar: true,
  chunkMetaBinaryColumnarMaxBytes: 64 * 1024 * 1024,
  chunkMetaJsonlThreshold: 200000,
  chunkMetaShardSize: 100,
  chunkMetaJsonlEstimateThresholdBytes: 8 * 1024 * 1024,
  maxJsonBytes: 32 * 1024 * 1024
});

assert.equal(oversizedBinaryPlan.chunkMetaUseJsonl, true, 'expected oversized binary test plan to use JSONL');
assert.equal(oversizedBinaryPlan.chunkMetaUseShards, true, 'expected oversized binary test plan to require sharding');
assert.equal(
  oversizedBinaryPlan.chunkMetaBinaryColumnar,
  false,
  'expected oversized sharded chunk_meta plans to disable optional binary-columnar output'
);
assert.match(
  String(oversizedBinaryPlan.chunkMetaBinaryColumnarDisabledReason || ''),
  /exceeds binary-columnar max/i,
  'expected disable reason for oversized binary-columnar output'
);

console.log('chunk_meta plan estimate threshold test passed');
