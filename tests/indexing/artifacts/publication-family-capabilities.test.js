#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  applyArtifactPublicationFamilyMeta,
  listArtifactPublicationFamilyCapabilities,
  resolveArtifactPublicationFamilyCapability
} from '../../../src/index/build/artifacts/publication-family-capabilities.js';

const families = listArtifactPublicationFamilyCapabilities();
assert.equal(Array.isArray(families), true, 'expected family capability registry to be listable');
assert.equal(families.length >= 10, true, 'expected a substantial family capability registry');

const chunkMeta = resolveArtifactPublicationFamilyCapability('chunk-meta');
assert.deepEqual(
  {
    family: chunkMeta?.family,
    laneHint: chunkMeta?.laneHint,
    streamability: chunkMeta?.streamability,
    shardability: chunkMeta?.shardability,
    progressUnit: chunkMeta?.progressUnit,
    exclusivePublisherFamily: chunkMeta?.exclusivePublisherFamily
  },
  {
    family: 'chunk-meta',
    laneHint: 'massive',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'chunks',
    exclusivePublisherFamily: 'chunk-meta-binary-columnar'
  },
  'expected chunk-meta capability metadata to describe heavyweight sharded closeout behavior'
);

const fieldedPostingsMeta = applyArtifactPublicationFamilyMeta('fielded-postings', {
  estimatedBytes: 1024
});
assert.deepEqual(
  {
    family: fieldedPostingsMeta.family,
    laneHint: fieldedPostingsMeta.laneHint,
    progressUnit: fieldedPostingsMeta.progressUnit
  },
  {
    family: 'fielded-postings',
    laneHint: 'heavy',
    progressUnit: 'tokens'
  },
  'expected family metadata application to fill in planner defaults'
);

const explicitOverride = applyArtifactPublicationFamilyMeta('artifact-stats', {
  laneHint: 'light',
  progressUnit: 'entries'
});
assert.deepEqual(
  {
    laneHint: explicitOverride.laneHint,
    progressUnit: explicitOverride.progressUnit
  },
  {
    laneHint: 'light',
    progressUnit: 'entries'
  },
  'expected explicit metadata to override family defaults where necessary'
);

console.log('publication family capabilities test passed');
