#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ARTIFACT_SCHEMA_DEFS, ARTIFACT_SCHEMA_HASH } from '../../src/shared/artifact-schemas.js';
import { ARTIFACT_SCHEMAS } from '../../src/index/build/artifacts/schema.js';
import { sha1 } from '../../src/shared/hash.js';
import { stableStringify } from '../../src/shared/stable-json.js';

const registrySerialized = stableStringify(ARTIFACT_SCHEMA_DEFS);
const buildSerialized = stableStringify(ARTIFACT_SCHEMAS);

assert.strictEqual(
  registrySerialized,
  buildSerialized,
  'artifact schema registry differs between build and validate paths'
);

assert.strictEqual(
  ARTIFACT_SCHEMA_HASH,
  sha1(registrySerialized),
  'artifact schema hash must derive from the canonical registry'
);

console.log('schema registry single source test passed');
