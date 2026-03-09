#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  canDispatchArtifactWriteEntry,
  resolveArtifactExclusivePublisherFamily,
  resolveArtifactWriteBytesInFlightLimit
} from '../../../src/index/build/artifacts/write-strategy.js';

assert.equal(
  resolveArtifactExclusivePublisherFamily('chunk_meta.binary-columnar.bundle'),
  'chunk-meta-binary-columnar',
  'expected chunk_meta binary-columnar family classification'
);
assert.equal(
  resolveArtifactExclusivePublisherFamily('field_postings.json'),
  'field-postings',
  'expected field_postings family classification'
);
assert.equal(
  resolveArtifactExclusivePublisherFamily('token_postings.packed.bin'),
  'token-postings',
  'expected token_postings family classification'
);
assert.equal(
  resolveArtifactExclusivePublisherFamily('pieces/manifest.json'),
  null,
  'expected non-huge manifest writes to remain outside exclusive publisher families'
);

const bytesBudget = resolveArtifactWriteBytesInFlightLimit({
  throughputBytesPerSec: 96 * 1024 * 1024,
  writeConcurrency: 6
});
assert.equal(bytesBudget >= 128 * 1024 * 1024, true, 'expected bounded bytes-in-flight budget floor');
assert.equal(bytesBudget <= 768 * 1024 * 1024, true, 'expected bounded bytes-in-flight budget ceiling');

const activeHugeEntries = [{
  label: 'token_postings.packed.bin',
  estimatedBytes: 420 * 1024 * 1024
}];
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'field_postings.binary-columnar.bundle',
      estimatedBytes: 180 * 1024 * 1024
    },
    activeEntries: activeHugeEntries,
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  true,
  'expected different huge publisher families to overlap when the shared bytes budget allows it'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'token_postings.json',
      estimatedBytes: 180 * 1024 * 1024
    },
    activeEntries: activeHugeEntries,
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  false,
  'expected same huge publisher family to remain serialized'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'pieces/manifest.json',
      estimatedBytes: 4096
    },
    activeEntries: activeHugeEntries,
    maxBytesInFlight: bytesBudget
  }),
  true,
  'expected light writes to remain dispatchable while a huge publisher is active'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 320 * 1024 * 1024
    },
    activeEntries: [{
      label: 'repo_map.json',
      estimatedBytes: 220 * 1024 * 1024
    }],
    maxBytesInFlight: 400 * 1024 * 1024
  }),
  false,
  'expected bytes-in-flight budget to block oversized overlapping writes even without an exclusive family conflict'
);

console.log('artifact huge write policy test passed');
