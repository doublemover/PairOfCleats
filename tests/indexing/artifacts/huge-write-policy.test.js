#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  canDispatchArtifactWriteEntry,
  resolveArtifactEffectiveDispatchBytes,
  resolveArtifactExclusivePublisherFamily,
  resolveArtifactWritePhaseClass,
  resolveArtifactWriteBytesInFlightLimit,
  shouldEagerStartArtifactWrite
} from '../../../src/index/build/artifacts/write-strategy.js';

assert.equal(
  resolveArtifactWritePhaseClass('materialize:chunk-meta-binary-columnar'),
  'materialize',
  'expected materialize phase classification'
);
assert.equal(
  resolveArtifactWritePhaseClass('publish:chunk-meta-binary-meta'),
  'publish',
  'expected publish phase classification'
);
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
      label: 'field_postings.binary-columnar.bundle',
      estimatedBytes: 300 * 1024 * 1024
    },
    activeEntries: [{
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 320 * 1024 * 1024,
      phase: 'publish:chunk-meta-binary-meta'
    }],
    maxBytesInFlight: 400 * 1024 * 1024
  }),
  true,
  'expected publish-phase huge writes to consume only a reduced budget weight'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'field_postings.binary-columnar.bundle',
      estimatedBytes: 300 * 1024 * 1024
    },
    activeEntries: [{
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 320 * 1024 * 1024,
      phase: 'materialize:chunk-meta-binary-columnar'
    }],
    maxBytesInFlight: 400 * 1024 * 1024
  }),
  false,
  'expected materialize-phase huge writes to hold the full bytes-in-flight budget'
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
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 900 * 1024 * 1024
    },
    activeEntries: [{
      label: 'pieces/manifest.json',
      estimatedBytes: 4096
    }],
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  false,
  'expected oversize writes to require an exclusive dispatch window'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 900 * 1024 * 1024
    },
    activeEntries: [{
      label: 'chunk_meta.binary-columnar.meta.json',
      estimatedBytes: 4096,
      phase: 'closeout:chunk-meta-binary-meta'
    }],
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  true,
  'expected oversize writes to remain dispatchable when only zero-weight closeout entries are active'
);
assert.equal(
  canDispatchArtifactWriteEntry({
    entry: {
      label: 'repo_map.json',
      lane: 'heavy'
    },
    activeEntries: [{
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 320 * 1024 * 1024
    }],
    maxBytesInFlight: 384 * 1024 * 1024
  }),
  false,
  'expected unknown heavy writes to use a conservative dispatch floor'
);
assert.equal(
  resolveArtifactEffectiveDispatchBytes({
    label: 'repo_map.json',
    lane: 'heavy'
  }),
  128 * 1024 * 1024,
  'expected heavy unlabeled writes to inherit the conservative heavy floor'
);
assert.equal(
  shouldEagerStartArtifactWrite({
    entry: {
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 128 * 1024 * 1024,
      lane: 'massive',
      eagerStart: true
    },
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  true,
  'expected moderate massive binary-columnar writes to remain eager-start eligible'
);
assert.equal(
  shouldEagerStartArtifactWrite({
    entry: {
      label: 'chunk_meta.binary-columnar.bundle',
      estimatedBytes: 900 * 1024 * 1024,
      lane: 'massive',
      eagerStart: true
    },
    maxBytesInFlight: 768 * 1024 * 1024
  }),
  false,
  'expected oversize binary-columnar writes to avoid eager-start overlap'
);

console.log('artifact huge write policy test passed');
