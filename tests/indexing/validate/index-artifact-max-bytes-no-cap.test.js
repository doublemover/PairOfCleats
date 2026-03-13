#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveArtifactValidationMaxBytes } from '../../../src/index/validate/chunk-meta.js';

const twoGiB = 2 * 1024 * 1024 * 1024;
const resolved = resolveArtifactValidationMaxBytes({
  manifest: {
    pieces: [
      { name: 'chunk_meta', bytes: twoGiB }
    ]
  },
  artifactNames: new Set(['chunk_meta']),
  baseMaxBytes: 128
});

assert.ok(
  resolved > twoGiB,
  'expected validation max-bytes budget to honor manifest size without hard truncation'
);

console.log('index-validate artifact max-bytes no-cap test passed');
