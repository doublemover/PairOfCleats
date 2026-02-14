#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  LEGACY_PROFILE_NORMALIZATION_WARNING,
  normalizeLoadedIndexState,
  resetLegacyProfileNormalizationWarningForTests
} from '../../../src/retrieval/cli/index-state.js';

resetLegacyProfileNormalizationWarningForTests();

const warnings = [];
const onCompatibilityWarning = (message) => warnings.push(String(message || ''));

const codeState = normalizeLoadedIndexState(
  {
    mode: 'code',
    generatedAt: new Date().toISOString()
  },
  { onCompatibilityWarning }
);
const proseState = normalizeLoadedIndexState(
  {
    mode: 'prose',
    generatedAt: new Date().toISOString()
  },
  { onCompatibilityWarning }
);

assert.equal(codeState?.profile?.id, 'default', 'expected code state to normalize to default profile');
assert.equal(proseState?.profile?.id, 'default', 'expected prose state to normalize to default profile');
assert.equal(warnings.length, 1, 'expected legacy profile warning to emit once per process');
assert.equal(
  warnings[0],
  LEGACY_PROFILE_NORMALIZATION_WARNING,
  'expected canonical warning message for legacy profile normalization'
);

console.log('legacy index without profile normalizes default test passed');
