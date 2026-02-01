#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';
import {
  ARTIFACT_SURFACE_VERSION,
  SHARDED_JSONL_META_SCHEMA_VERSION
} from '../../../src/contracts/versioning.js';

const manifestBase = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: []
};

assert.ok(validateArtifact('pieces_manifest', manifestBase).ok, 'baseline manifest should validate');
assert.ok(
  !validateArtifact('pieces_manifest', { ...manifestBase, extra: true }).ok,
  'manifest should reject unknown top-level fields'
);
assert.ok(
  validateArtifact('pieces_manifest', { ...manifestBase, extensions: { vendor: { ok: true } } }).ok,
  'manifest should allow extensions object'
);

const indexStateBase = {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
};

assert.ok(validateArtifact('index_state', indexStateBase).ok, 'baseline index_state should validate');
assert.ok(
  !validateArtifact('index_state', { ...indexStateBase, extra: true }).ok,
  'index_state should reject unknown top-level fields'
);

const metaBase = {
  schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
  artifact: 'chunk_meta',
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: 'none',
  totalRecords: 0,
  totalBytes: 0,
  maxPartRecords: 0,
  maxPartBytes: 0,
  targetMaxBytes: null,
  parts: []
};

assert.ok(validateArtifact('chunk_meta_meta', metaBase).ok, 'baseline meta should validate');
assert.ok(
  !validateArtifact('chunk_meta_meta', { ...metaBase, extra: true }).ok,
  'meta should reject unknown top-level fields'
);

console.log('additional properties policy test passed');
