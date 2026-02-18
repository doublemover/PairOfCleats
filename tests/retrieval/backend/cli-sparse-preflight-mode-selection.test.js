#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSparsePreflightModes } from '../../../src/retrieval/cli.js';

const baseModes = ['code', 'prose', 'extracted-prose', 'records'];

const defaultModes = resolveSparsePreflightModes({
  selectedModes: baseModes,
  requiresExtractedProse: false,
  loadExtractedProseSqlite: false
});
assert.deepEqual(
  defaultModes,
  ['code', 'prose'],
  'optional extracted-prose should be excluded from sparse preflight when not loaded'
);

const loadedOptionalModes = resolveSparsePreflightModes({
  selectedModes: baseModes,
  requiresExtractedProse: false,
  loadExtractedProseSqlite: true
});
assert.deepEqual(
  loadedOptionalModes,
  ['code', 'prose', 'extracted-prose'],
  'loaded optional extracted-prose should be included in sparse preflight'
);

const requiredExtractedOnly = resolveSparsePreflightModes({
  selectedModes: ['extracted-prose'],
  requiresExtractedProse: true,
  loadExtractedProseSqlite: false
});
assert.deepEqual(
  requiredExtractedOnly,
  ['extracted-prose'],
  'required extracted-prose mode should always be included'
);

console.log('cli sparse preflight mode selection test passed');
