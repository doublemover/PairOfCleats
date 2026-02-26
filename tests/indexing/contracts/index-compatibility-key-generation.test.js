#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCompatibilityKey } from '../../../src/contracts/compatibility.js';

const runtime = {
  segmentsConfig: { mode: 'auto' },
  languageOptions: { javascript: { parser: 'babel' } },
  commentsConfig: {},
  embeddingEnabled: false,
  embeddingService: false
};

const tokenizationKeys = { code: 'tok-code', prose: 'tok-prose' };
const keyA = buildCompatibilityKey({
  runtime,
  modes: ['code', 'prose'],
  tokenizationKeys
});
const keyB = buildCompatibilityKey({
  runtime,
  modes: ['prose', 'code'],
  tokenizationKeys
});
assert.equal(keyA, keyB, 'compatibilityKey should not depend on mode ordering');

const keyC = buildCompatibilityKey({
  runtime,
  modes: ['code', 'prose'],
  tokenizationKeys: { code: 'tok-code', prose: 'tok-prose-2' }
});
assert.notEqual(keyA, keyC, 'compatibilityKey should change when tokenization keys change');

const keyD = buildCompatibilityKey({
  runtime,
  modes: ['code'],
  tokenizationKeys: { code: 'tok-code' }
});
assert.notEqual(keyA, keyD, 'compatibilityKey should include the enabled mode set');

const keyNoModes = buildCompatibilityKey({
  runtime,
  modes: [],
  tokenizationKeys
});
const keyMalformedModes = buildCompatibilityKey({
  runtime,
  modes: { code: true, prose: true },
  tokenizationKeys
});
assert.equal(
  keyMalformedModes,
  keyNoModes,
  'compatibilityKey should treat malformed mode payloads as an empty mode set'
);

const keyE = buildCompatibilityKey({
  runtime: {
    ...runtime,
    profile: { id: 'vector_only', schemaVersion: 1 }
  },
  modes: ['code', 'prose'],
  tokenizationKeys
});
assert.notEqual(keyA, keyE, 'compatibilityKey should include index profile identity');

console.log('compatibility key generation test passed');
