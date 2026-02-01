#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ARTIFACT_SURFACE_VERSION,
  SHARDED_JSONL_META_SCHEMA_VERSION,
  parseSemver,
  resolveSupportedMajors
} from '../../../src/contracts/versioning.js';

const surface = parseSemver(ARTIFACT_SURFACE_VERSION);
const meta = parseSemver(SHARDED_JSONL_META_SCHEMA_VERSION);
assert.ok(surface, 'artifactSurfaceVersion must be SemVer');
assert.ok(meta, 'sharded meta schemaVersion must be SemVer');

const supported = resolveSupportedMajors('3.2.1');
assert.deepStrictEqual(supported, [3, 2], 'N-1 major support should be encoded');

console.log('semver policy test passed');
