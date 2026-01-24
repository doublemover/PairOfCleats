#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ARTIFACT_SURFACE_VERSION,
  SHARDED_JSONL_META_SCHEMA_VERSION,
  resolveSupportedMajors
} from '../../src/contracts/versioning.js';
import {
  adaptArtifactSurfacePayload,
  adaptShardedMetaPayload
} from '../../src/contracts/adapters/index.js';

const supported = resolveSupportedMajors('2.1.0');
assert.deepStrictEqual(supported, [2, 1], 'N-1 major support should be encoded');

const surfaceOk = adaptArtifactSurfacePayload({ ok: true }, ARTIFACT_SURFACE_VERSION);
assert.ok(surfaceOk.ok, 'current artifact surface version should be supported');

const metaOk = adaptShardedMetaPayload({ ok: true }, SHARDED_JSONL_META_SCHEMA_VERSION);
assert.ok(metaOk.ok, 'current sharded meta version should be supported');

const surfaceBad = adaptArtifactSurfacePayload({ ok: true }, '99.0.0');
assert.ok(!surfaceBad.ok, 'unsupported artifact surface major should fail');

console.log('N-1 adapter test passed');
