#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveVectorOnlyShortcutPolicy } from '../../../src/index/build/indexer/pipeline.js';

const defaultVectorOnly = resolveVectorOnlyShortcutPolicy({
  profile: { id: 'vector_only' },
  indexingConfig: { profile: 'vector_only' }
});
assert.equal(defaultVectorOnly.enabled, true, 'expected vector-only shortcuts to be enabled');
assert.equal(defaultVectorOnly.disableImportGraph, true, 'expected import graph shortcut enabled by default');
assert.equal(defaultVectorOnly.disableCrossFileInference, true, 'expected cross-file shortcut enabled by default');

const optOutVectorOnly = resolveVectorOnlyShortcutPolicy({
  profile: { id: 'vector_only' },
  indexingConfig: {
    profile: 'vector_only',
    vectorOnly: {
      disableImportGraph: false,
      disableCrossFileInference: false
    }
  }
});
assert.equal(optOutVectorOnly.enabled, true, 'expected vector-only shortcuts to stay active for vector-only profile');
assert.equal(optOutVectorOnly.disableImportGraph, false, 'expected import graph shortcut opt-out to be honored');
assert.equal(optOutVectorOnly.disableCrossFileInference, false, 'expected cross-file shortcut opt-out to be honored');

const defaultProfile = resolveVectorOnlyShortcutPolicy({
  profile: { id: 'default' },
  indexingConfig: { profile: 'default' }
});
assert.equal(defaultProfile.enabled, false, 'expected shortcuts disabled for default profile');
assert.equal(defaultProfile.disableImportGraph, false, 'expected no import graph shortcut outside vector-only profile');
assert.equal(defaultProfile.disableCrossFileInference, false, 'expected no cross-file shortcut outside vector-only profile');

console.log('vector-only analysis shortcuts policy test passed');
